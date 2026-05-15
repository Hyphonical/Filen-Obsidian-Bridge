import { Notice, TFile } from 'obsidian';
import * as path from 'path';
import * as fs from 'fs';
import type FilenSyncPlugin from '../main';
import { FilenCloudClient } from './filen-notes';
import { NoteIndex } from './note-index';

type SyncOpType = 'CREATE' | 'MODIFY' | 'RENAME' | 'DELETE';

interface SyncOperation {
	type: SyncOpType;
	path: string;
	newPath?: string;
}

/** Metadata pulled from a remote note (for comparison during pull cycles). */
interface RemoteNoteMeta {
	uuid: string;
	title: string;
	editedTimestamp: number;
	trash: boolean;
}

/**
 * Two-tier sync engine:
 * - Fast debounce (2s idle) for responsiveness
 * - Hard ceiling (10s max) so we always save eventually
 * - Handles both markdown notes (via Notes API) and binary attachments (via FS API)
 * - Pull cycle downloads remote notes and attachments on startup + manual trigger
 */
export class FilenSyncEngine {
	private plugin: FilenSyncPlugin;
	private cloud: FilenCloudClient;
	private index: NoteIndex;

	private pending: SyncOperation[] = [];
	private fastTimer: number | null = null;
	private forceTimer: number | null = null;
	private processing = false;
	private pulling = false;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
		this.cloud = new FilenCloudClient(plugin);
		this.index = new NoteIndex(plugin);
	}

	/** Apply updated timer settings on the fly. */
	updateTimers(): void {
		if (this.fastTimer !== null) {
			window.clearTimeout(this.fastTimer);
			this.fastTimer = null;
		}
		if (this.forceTimer !== null) {
			window.clearTimeout(this.forceTimer);
			this.forceTimer = null;
		}
	}

	/** Queue a vault event and restart the fast debounce timer. */
	queue(op: SyncOperation): void {
		if (!this.cloud.isReady) return;

		this.pending.push(op);
		this.resetFastTimer();

		if (this.forceTimer === null) {
			this.forceTimer = window.setTimeout(() => {
				this.forceTimer = null;
				this.flush();
			}, this.plugin.settings.forceDelayMs);
		}
	}

	/** Tear down timers. Call from Plugin.onunload(). */
	destroy(): void {
		if (this.fastTimer !== null) {
			window.clearTimeout(this.fastTimer);
			this.fastTimer = null;
		}
		if (this.forceTimer !== null) {
			window.clearTimeout(this.forceTimer);
			this.forceTimer = null;
		}
	}

	// ────────────────────────────────
	//  PULL CYCLE (Filen → Obsidian)
	// ────────────────────────────────

	/**
	 * Pull all notes and attachments from Filen and write them to the vault.
	 * Pauses the VaultListener during the pull to avoid feedback loops.
	 * @param force - If true, overwrite all local files with remote versions
	 *                regardless of edit timestamps.
	 */
	async pullAll(force = false): Promise<{ notes: number; attachments: number }> {
		if (this.pulling) {
			console.log('[FilenSync] Pull already in progress, skipping.');
			return { notes: 0, attachments: 0 };
		}
		if (!this.cloud.isReady) {
			console.log('[FilenSync] Not authenticated, skipping pull.');
			return { notes: 0, attachments: 0 };
		}

		this.pulling = true;
		// Pause local listener to avoid re-uploading files we're about to download
		this.plugin.vaultListener?.pause();
		this.plugin.statusMessage = force ? 'Force pulling…' : 'Pulling…';

		let notesPulled = 0;
		let attachmentsPulled = 0;

		try {
			new Notice('Filen: Pulling notes from cloud...');

			// 1. Pull the cloud-backed note index
			const remoteIndex = await this.cloud.pullNoteIndex();
			if (remoteIndex) {
				// Merge remote index with local
				for (const [vaultPath, uuid] of Object.entries(remoteIndex)) {
					if (!this.index.getByPath(vaultPath)) {
						this.index.set(vaultPath, uuid);
					}
				}
			}

			// 2. Fetch all remote notes, compare timestamps, download updated ones
			const allNotes = await this.cloud.listAllNotes();
			console.log(`[FilenSync] Pull: ${allNotes.length} remote notes found.`);
			this.plugin.statusMessage = `Pulling ${allNotes.length} notes…`;

			for (const note of allNotes) {
				if (note.trash) continue;

				const localPath = this.index.getByUUID(note.uuid);
				const lastPull = force ? 0 : this.plugin.settings.lastPullTimestamp;

				// Skip if we have a local file that's newer than the remote note
				if (!force && localPath && note.editedTimestamp <= lastPull) {
					continue;
				}

				// Determine the local path for this note
				const targetPath = localPath || this.inferPath(note.title);

				if (!force && localPath) {
					// Check if local file is newer
					const localFile = this.plugin.app.vault.getAbstractFileByPath(localPath);
					if (localFile instanceof TFile && localFile.stat.mtime > note.editedTimestamp) {
						continue; // Local is newer, don't overwrite
					}
				}

				try {
					const content = await this.cloud.getNoteContent(note.uuid);
					await this.writeVaultFile(targetPath, content.content);
					this.index.set(targetPath, note.uuid);
					notesPulled++;
					console.log(`[FilenSync] Pulled note: ${targetPath}`);
				} catch (err) {
					console.error(`[FilenSync] Failed to pull note ${note.uuid}:`, err);
				}
			}

			// 3. Pull attachments from Filen Drive
			const vaultRoot = this.cloud.vaultRootPath;
			try {
				await this.cloud.ensureVaultRoot();
				const fsFiles = await this.plugin.authManager.sdk!.fs().readdir({ path: vaultRoot, recursive: true });

				for (const remotePath of fsFiles) {
					// Skip the note-index metadata file itself
					if (remotePath === 'note-index.json') continue;

					// Convert remote path to local vault path
					const localRelPath = path.posix.relative(vaultRoot, remotePath);
					const localFile = this.plugin.app.vault.getAbstractFileByPath(localRelPath);

					if (!force && localFile instanceof TFile) {
						continue; // Already exists locally
					}

					try {
						const buffer = await this.cloud.downloadAttachmentBuffer(remotePath);
						await this.writeVaultBinary(localRelPath, buffer);
						attachmentsPulled++;
						console.log(`[FilenSync] Pulled attachment: ${localRelPath}`);
					} catch (err) {
						console.error(`[FilenSync] Failed to pull attachment ${remotePath}:`, err);
					}
				}
			} catch (err) {
				console.warn('[FilenSync] FS pull skipped (vault root may not exist yet):', err);
			}

			// Update last pull timestamp
			this.plugin.settings.lastPullTimestamp = Date.now();
			await this.plugin.saveSettings();

			if (notesPulled > 0 || attachmentsPulled > 0) {
				new Notice(`Filen: Pulled ${notesPulled} notes, ${attachmentsPulled} attachments`);
			} else {
				new Notice('Filen: Already up to date');
			}
		} catch (err: any) {
			console.error('[FilenSync] Pull cycle failed:', err);
			new Notice(`Filen pull error: ${err.message || 'unknown'}`);
		} finally {
			// Push the merged index back to Filen Drive for cross-device sync
			try {
				await this.cloud.pushNoteIndex(this.plugin.settings.noteIndex);
			} catch (err) {
				console.warn('[FilenSync] Failed to push note index:', err);
			}

			this.plugin.vaultListener?.resume();
			this.pulling = false;
			this.plugin.statusMessage = '';
		}

		return { notes: notesPulled, attachments: attachmentsPulled };
	}

	// ────────────────────────────────
	//  PUSH (Obsidian → Filen)
	// ────────────────────────────────

	private resetFastTimer(): void {
		if (this.fastTimer !== null) {
			window.clearTimeout(this.fastTimer);
		}
		this.fastTimer = window.setTimeout(() => {
			this.fastTimer = null;
			this.flush();
		}, this.plugin.settings.fastDelayMs);
	}

	/** Process every queued operation sequentially. */
	private async flush(): Promise<void> {
		if (this.processing || this.pending.length === 0) return;
		if (this.forceTimer !== null) {
			window.clearTimeout(this.forceTimer);
			this.forceTimer = null;
		}
		if (this.fastTimer !== null) {
			window.clearTimeout(this.fastTimer);
			this.fastTimer = null;
		}

		this.processing = true;
		const batch = this.pending.splice(0);

		try {
			const deduped = this.deduplicate(batch);
			this.plugin.statusMessage = `Saving ${deduped.length} file${deduped.length !== 1 ? 's' : ''}…`;
			for (const op of deduped) {
				await this.processOperation(op);
			}
		} catch (err: any) {
			console.error('[FilenSync] Flush failed:', err);
			new Notice(`Filen sync error: ${err.message || 'unknown'}`);
		} finally {
			this.processing = false;
			this.plugin.statusMessage = '';
			if (this.pending.length > 0) {
				this.resetFastTimer();
			}
		}
	}

	private deduplicate(ops: SyncOperation[]): SyncOperation[] {
		const result: SyncOperation[] = [];
		const seenModify = new Set<string>();

		for (let i = ops.length - 1; i >= 0; i--) {
			const op = ops[i];
			if (op.type === 'MODIFY') {
				if (!seenModify.has(op.path)) {
					seenModify.add(op.path);
					result.unshift(op);
				}
			} else {
				result.unshift(op);
			}
		}

		return result;
	}

	private async processOperation(op: SyncOperation): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(op.path);
		if (!file && op.type !== 'RENAME' && op.type !== 'DELETE') {
			console.warn(`[FilenSync] File gone before sync: ${op.path}`);
			return;
		}

		// Route to notes or attachments based on extension
		if (op.path.endsWith('.md')) {
			await this.processNoteOperation(op, file as TFile | null);
		} else {
			await this.processAttachmentOperation(op, file as TFile | null);
		}
	}

	// ── Note operations (Notes API) ──

	private async processNoteOperation(op: SyncOperation, file: TFile | null): Promise<void> {
		switch (op.type) {
			case 'CREATE':
				if (file) await this.handleNoteCreate(file);
				break;
			case 'MODIFY':
				if (file) await this.handleNoteModify(file);
				break;
			case 'RENAME':
				await this.handleNoteRename(op.path, op.newPath!);
				break;
			case 'DELETE':
				await this.handleNoteDelete(op.path);
				break;
		}
	}

	private async handleNoteCreate(file: TFile): Promise<void> {
		if (this.index.getByPath(file.path)) return;
		const title = file.basename;
		const content = await this.plugin.app.vault.cachedRead(file);
		const uuid = await this.cloud.createNote(title, content, 'md');
		this.index.set(file.path, uuid);
		// Also push index to cloud
		await this.cloud.pushNoteIndex(this.plugin.settings.noteIndex);
		console.log(`[FilenSync] Created remote note ${uuid} for ${file.path}`);
	}

	private async handleNoteModify(file: TFile): Promise<void> {
		const uuid = this.index.getByPath(file.path);
		if (!uuid) {
			await this.handleNoteCreate(file);
			return;
		}
		const content = await this.plugin.app.vault.cachedRead(file);
		await this.cloud.updateNoteContent(uuid, content, 'md');
		console.log(`[FilenSync] Updated remote note ${uuid}`);
	}

	private async handleNoteRename(oldPath: string, newPath: string): Promise<void> {
		this.index.rename(oldPath, newPath);
		const uuid = this.index.getByPath(newPath);
		if (uuid) {
			const newName = newPath.split('/').pop()?.replace(/\.md$/, '') || newPath;
			await this.cloud.updateNoteTitle(uuid, newName);
		}
		await this.cloud.pushNoteIndex(this.plugin.settings.noteIndex);
	}

	private async handleNoteDelete(localPath: string): Promise<void> {
		const uuid = this.index.getByPath(localPath);
		if (uuid) {
			await this.cloud.trashNote(uuid);
			this.index.remove(localPath);
			await this.cloud.pushNoteIndex(this.plugin.settings.noteIndex);
			console.log(`[FilenSync] Trashed remote note ${uuid}`);
		}
	}

	// ── Attachment operations (FS API) ──

	private async processAttachmentOperation(op: SyncOperation, file: TFile | null): Promise<void> {
		switch (op.type) {
			case 'CREATE':
				if (file) await this.handleAttachmentCreate(file);
				break;
			case 'MODIFY':
				if (file) await this.handleAttachmentModify(file);
				break;
			case 'RENAME':
				await this.handleAttachmentRename(op.path, op.newPath!);
				break;
			case 'DELETE':
				await this.handleAttachmentDelete(op.path);
				break;
		}
	}

	private async handleAttachmentCreate(file: TFile): Promise<void> {
		if (this.plugin.settings.attachmentIndex[file.path]) return;

		const { uuid } = await this.cloud.uploadAttachment(file.path);
		this.plugin.settings.attachmentIndex[file.path] = uuid;
		await this.plugin.saveSettings();
		console.log(`[FilenSync] Uploaded attachment ${file.path} -> ${uuid}`);
	}

	private async handleAttachmentModify(file: TFile): Promise<void> {
		// Re-upload the entire file (attachments are binary, no partial updates)
		const uuid = this.plugin.settings.attachmentIndex[file.path];
		if (uuid) {
			const remotePath = this.attachmentRemotePath(file.path);
			await this.cloud.deleteAttachment(remotePath);
		}
		delete this.plugin.settings.attachmentIndex[file.path];
		await this.handleAttachmentCreate(file);
	}

	private async handleAttachmentRename(oldPath: string, newPath: string): Promise<void> {
		const uuid = this.plugin.settings.attachmentIndex[oldPath];
		if (uuid) {
			delete this.plugin.settings.attachmentIndex[oldPath];
			this.plugin.settings.attachmentIndex[newPath] = uuid;
			await this.plugin.saveSettings();

			// Rename on Filen Drive
			const oldRemotePath = this.attachmentRemotePath(oldPath);
			const newRemotePath = this.attachmentRemotePath(newPath);
			const dir = path.posix.dirname(newRemotePath);
			await this.plugin.authManager.sdk!.fs().mkdir({ path: dir });
			await this.plugin.authManager.sdk!.fs().rename({ from: oldRemotePath, to: newRemotePath });
		}
	}

	private async handleAttachmentDelete(localPath: string): Promise<void> {
		const remotePath = this.attachmentRemotePath(localPath);
		await this.cloud.deleteAttachment(remotePath);
		delete this.plugin.settings.attachmentIndex[localPath];
		await this.plugin.saveSettings();
		console.log(`[FilenSync] Deleted attachment ${localPath}`);
	}

	private attachmentRemotePath(localPath: string): string {
		return path.posix.join(this.cloud.vaultRootPath, localPath);
	}

	// ────────────────────────────────
	//  HELPERS
	// ────────────────────────────────

	/** Infer a local vault path from a note title. */
	private inferPath(title: string): string {
		const safeName = title.replace(/[/\\?%*:|"<>]/g, '-');
		return `${safeName}.md`;
	}

	/** Write text content to a vault file, creating intermediate folders as needed. */
	private async writeVaultFile(vaultPath: string, content: string): Promise<void> {
		const dir = path.posix.dirname(vaultPath);
		if (dir && dir !== '.') {
			const dirExists = this.plugin.app.vault.getAbstractFileByPath(dir);
			if (!dirExists) {
				await this.plugin.app.vault.createFolder(dir);
			}
		}

		const existing = this.plugin.app.vault.getAbstractFileByPath(vaultPath);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modify(existing, content);
		} else {
			await this.plugin.app.vault.create(vaultPath, content);
		}
	}

	/** Write binary content to a vault file. */
	private async writeVaultBinary(vaultPath: string, buffer: Buffer): Promise<void> {
		const vaultRoot = (this.plugin.app.vault.adapter as any).basePath as string;
		const absolutePath = path.join(vaultRoot, vaultPath);

		const dir = path.dirname(absolutePath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(absolutePath, buffer);
	}
}
