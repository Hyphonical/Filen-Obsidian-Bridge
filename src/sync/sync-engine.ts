import { Notice, TFile } from 'obsidian';
import * as path from 'path';
import type FilenSyncPlugin from '../main';
import { FilenDriveClient } from './filen-drive';

type SyncOpType = 'CREATE' | 'MODIFY' | 'RENAME' | 'DELETE';

interface SyncOperation {
	type: SyncOpType;
	path: string;
	newPath?: string;
}

/**
 * Uniform file-sync engine.
 *
 * Every file — .md notes, .canvas, images, PDFs, .obsidian config — is
 * treated identically.  The remote folder tree on Filen Drive mirrors the
 * local vault tree.  No UUID tracking, no Notes API.
 *
 * Timer model:
 *  • Fast debounce (fastDelayMs): reset on every new edit.
 *  • Hard ceiling (forceDelayMs): flush no matter what.
 */
export class FilenSyncEngine {
	private plugin: FilenSyncPlugin;
	private drive: FilenDriveClient;

	private pending: SyncOperation[] = [];
	private fastTimer: number | null = null;
	private forceTimer: number | null = null;
	private pollTimer: number | null = null;
	private processing = false;
	private pulling = false;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
		this.drive = new FilenDriveClient(plugin);
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
		// Restart polling with the new interval
		this.stopPolling();
		this.startPolling();
	}

	/** Start periodic background pulls from Filen Drive. */
	startPolling(): void {
		const intervalSec = this.plugin.settings.pollIntervalSec;
		if (intervalSec <= 0 || !this.drive.isReady) return;

		this.pollTimer = window.setInterval(() => {
			void this.pullAll(false, true);
		}, intervalSec * 1000);
	}

	/** Stop periodic background pulls. */
	stopPolling(): void {
		if (this.pollTimer !== null) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	/** Queue a vault event and restart the fast debounce timer. */
	queue(op: SyncOperation): void {
		if (!this.drive.isReady) return;

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
		this.stopPolling();
	}

	// ═══════════════════════════════════════
	//  PULL CYCLE (Filen → Obsidian)
	// ═══════════════════════════════════════

	/**
	 * Pull all files from Filen Drive and write them to the local vault.
	 * Pauses the VaultListener during the pull to avoid re-upload loops.
	 *
	 * @param force - If true, overwrite all local files with remote versions
	 *                regardless of timestamps.
	 */
	async pullAll(force = false, silent = false): Promise<number> {
		if (this.pulling) {
			console.log('[FilenSync] Pull already in progress, skipping.');
			return 0;
		}
		if (!this.drive.isReady) {
			console.log('[FilenSync] Not authenticated, skipping pull.');
			return 0;
		}

		this.pulling = true;
		this.plugin.vaultListener?.pause();
		this.plugin.statusMessage = force ? 'Force pulling…' : 'Pulling…';

		let pulled = 0;

		try {
			const remoteFiles = await this.drive.listAllFiles();
			console.log(`[FilenSync] Pull: ${remoteFiles.length} remote files found.`);

			for (const localPath of remoteFiles) {
				try {
					const remotePath = this.drive.localToRemote(localPath);
					const remoteStat = await this.drive.stat(remotePath);

					const localFile = this.plugin.app.vault.getAbstractFileByPath(localPath);

					if (!force && localFile instanceof TFile && remoteStat) {
						// Compare local mtime against remote mtime.
						// Remote wins if it's strictly newer (latest-wins strategy).
						if (localFile.stat.mtime >= remoteStat.mtime) {
							continue; // local is same age or newer → skip
						}
					}

					// Download and write
					const buffer = await this.drive.downloadFile(remotePath);
					await this.writeVaultFile(localPath, buffer);
					pulled++;
					console.log(`[FilenSync] Pulled: ${localPath}`);
				} catch (err) {
					console.error(`[FilenSync] Failed to pull ${localPath}:`, err);
				}
			}

			// Update last pull timestamp — no longer needed since we compare
			// local mtime against remote mtime directly.

			if (!silent) {
				if (pulled > 0) {
					new Notice(`Filen: Pulled ${pulled} file${pulled !== 1 ? 's' : ''}`);
				} else {
					new Notice('Filen: Already up to date');
				}
			} else if (pulled > 0) {
				console.log(`[FilenSync] Background pull: ${pulled} file${pulled !== 1 ? 's' : ''} updated.`);
			}
		} catch (err: any) {
			console.error('[FilenSync] Pull cycle failed:', err);
			if (!silent) {
				new Notice(`Filen pull error: ${err.message || 'unknown'}`);
			}
		} finally {
			this.plugin.vaultListener?.resume();
			this.pulling = false;
			this.plugin.statusMessage = '';
		}

		return pulled;
	}

	/**
	 * Manually push every file in the vault that doesn't exist on Filen Drive
	 * or is newer than its remote counterpart.
	 * Does NOT pause the listener — this is a one-shot upload pass.
	 */
	async pushAll(): Promise<number> {
		if (!this.drive.isReady) {
			console.log('[FilenSync] Not authenticated, skipping push.');
			return 0;
		}

		this.plugin.statusMessage = 'Pushing…';
		let pushed = 0;

		try {
			new Notice('Filen: Pushing vault to cloud…');

			// Gather all local files
			const localFiles = this.plugin.app.vault.getFiles();
			// Get remote file listing for comparison
			const remoteFiles = await this.drive.listAllFiles();
			const remoteSet = new Set(remoteFiles);

			for (const file of localFiles) {
				try {
					const remoteExists = remoteSet.has(file.path);
					if (!remoteExists) {
						// New file — upload
						await this.drive.uploadFile(file.path);
						pushed++;
						console.log(`[FilenSync] Push (new): ${file.path}`);
					} else {
						// Check mtime for updates
						const remotePath = this.drive.localToRemote(file.path);
						const remoteStat = await this.drive.stat(remotePath);
						if (remoteStat && file.stat.mtime > remoteStat.mtime) {
							await this.drive.uploadFile(file.path);
							pushed++;
							console.log(`[FilenSync] Push (updated): ${file.path}`);
						}
					}
				} catch (err) {
					console.error(`[FilenSync] Push failed for ${file.path}:`, err);
				}
			}

			if (pushed > 0) {
				new Notice(`Filen: Pushed ${pushed} file${pushed !== 1 ? 's' : ''}`);
			} else {
				new Notice('Filen: Everything is already synced');
			}
		} catch (err: any) {
			console.error('[FilenSync] Push all failed:', err);
			new Notice(`Filen push error: ${err.message || 'unknown'}`);
		} finally {
			this.plugin.statusMessage = '';
		}

		return pushed;
	}

	// ═══════════════════════════════════════
	//  PUSH (Obsidian → Filen)
	// ═══════════════════════════════════════

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

		// Clear both timers
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

	/** Remove redundant MODIFY operations for the same path. */
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

	/** Route a single operation to the appropriate handler. */
	private async processOperation(op: SyncOperation): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(op.path);

		if (!file && op.type !== 'RENAME' && op.type !== 'DELETE') {
			console.warn(`[FilenSync] File gone before sync: ${op.path}`);
			return;
		}

		switch (op.type) {
			case 'CREATE':
				if (file instanceof TFile) await this.handleCreate(file);
				break;
			case 'MODIFY':
				if (file instanceof TFile) await this.handleModify(file);
				break;
			case 'RENAME':
				await this.handleRename(op.path, op.newPath!);
				break;
			case 'DELETE':
				await this.handleDelete(op.path);
				break;
		}
	}

	private async handleCreate(file: TFile): Promise<void> {
		try {
			await this.drive.uploadFile(file.path);
			console.log(`[FilenSync] Uploaded: ${file.path}`);
		} catch (err) {
			console.error(`[FilenSync] Upload failed ${file.path}:`, err);
		}
	}

	private async handleModify(file: TFile): Promise<void> {
		try {
			await this.drive.uploadFile(file.path);
			console.log(`[FilenSync] Updated: ${file.path}`);
		} catch (err) {
			console.error(`[FilenSync] Modify-upload failed ${file.path}:`, err);
		}
	}

	private async handleRename(oldPath: string, newPath: string): Promise<void> {
		try {
			const oldRemote = this.drive.localToRemote(oldPath);
			const newRemote = this.drive.localToRemote(newPath);

			// Is this a file (has extension) or a directory?
			const isFile = oldPath.includes('.');
			if (isFile) {
				await this.drive.renameFile(oldRemote, newRemote);
			} else {
				// Directory rename — move all children
				const allFiles = await this.drive.listAllFiles();
				const children = allFiles.filter(
					f => f === oldPath || f.startsWith(oldPath + '/')
				);

				for (const child of children) {
					const childNewPath = child.replace(oldPath, newPath);
					const childOldRemote = this.drive.localToRemote(child);
					const childNewRemote = this.drive.localToRemote(childNewPath);
					await this.drive.renameFile(childOldRemote, childNewRemote);
				}
			}

			console.log(`[FilenSync] Renamed: ${oldPath} → ${newPath}`);
		} catch (err) {
			console.error(`[FilenSync] Rename failed ${oldPath} → ${newPath}:`, err);
		}
	}

	private async handleDelete(localPath: string): Promise<void> {
		try {
			const remotePath = this.drive.localToRemote(localPath);

			// Is it a file (has extension) or a directory?
			const isFile = localPath.includes('.');
			if (isFile) {
				await this.drive.deleteFile(remotePath);
			} else {
				await this.drive.deleteDirectory(remotePath);
			}

			console.log(`[FilenSync] Deleted: ${localPath}`);
		} catch (err) {
			console.error(`[FilenSync] Delete failed ${localPath}:`, err);
		}
	}

	// ═══════════════════════════════════════
	//  HELPERS
	// ═══════════════════════════════════════

	/**
	 * Write a binary buffer into the vault, creating intermediate folders.
	 * Uses modifyBinary / createBinary so ALL file types (text, images, etc.)
	 * are handled uniformly.
	 */
	private async writeVaultFile(vaultPath: string, buffer: Buffer): Promise<void> {
		const dir = path.posix.dirname(vaultPath);
		if (dir && dir !== '.') {
			const dirExists = this.plugin.app.vault.getAbstractFileByPath(dir);
			if (!dirExists) {
				await this.plugin.app.vault.createFolder(dir);
			}
		}

		// Obsidian's vault API expects ArrayBuffer, not Node Buffer.
		// Buffer.buffer can be larger than the Buffer itself (shared backing store),
		// so we slice the exact range.
		const arrayBuffer = buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength
		) as ArrayBuffer;

		const existing = this.plugin.app.vault.getAbstractFileByPath(vaultPath);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modifyBinary(existing, arrayBuffer);
		} else {
			await this.plugin.app.vault.createBinary(vaultPath, arrayBuffer);
		}
	}
}
