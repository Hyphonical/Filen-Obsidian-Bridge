import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type FilenSyncPlugin from '../main';

type NoteType = 'text' | 'md' | 'code' | 'rich' | 'checklist';

/**
 * Unified cloud client that wraps both the Filen Notes API (for markdown)
 * and the Filen FS/Cloud API (for binary attachments).
 *
 * The FS client stores attachments under a configurable base path
 * (default "/obsidian-bridge/vault"), mirroring the vault structure.
 */
export class FilenCloudClient {
	private plugin: FilenSyncPlugin;
	/** Cached base folder UUID for FS operations. */
	private _baseFolderUUID: string | null = null;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
	}

	private get sdk() {
		return this.plugin.authManager.sdk;
	}

	/** FS base path for this vault — all attachments and metadata live here. */
	get vaultRootPath(): string {
		return '/.obsidian';
	}

	/** Whether we have an authenticated SDK ready. */
	get isReady(): boolean {
		return this.sdk !== null;
	}

	// ────────────────────────────────
	//  NOTES API (markdown content)
	// ────────────────────────────────

	/** Fetch a decrypted list of all notes from the cloud. */
	async listAllNotes(): Promise<
		{
			uuid: string;
			title: string;
			preview: string;
			type: NoteType;
			editedTimestamp: number;
			trash: boolean;
			archive: boolean;
		}[]
	> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		console.log('[FilenSync] Fetching all notes from Filen...');
		const notes = await this.sdk.notes().all();
		console.log(`[FilenSync] Fetched ${notes.length} notes`);
		return notes.map(n => ({
			uuid: n.uuid,
			title: n.title,
			preview: n.preview,
			type: n.type as NoteType,
			editedTimestamp: n.editedTimestamp,
			trash: n.trash,
			archive: n.archive,
		}));
	}

	/** Fetch decrypted content, type and metadata for a note. */
	async getNoteContent(uuid: string): Promise<{
		content: string;
		type: NoteType;
		editedTimestamp: number;
		preview: string;
	}> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		const result = await this.sdk.notes().content({ uuid });
		return {
			content: result.content,
			type: result.type as NoteType,
			editedTimestamp: result.editedTimestamp,
			preview: result.preview,
		};
	}

	/**
	 * Create a new remote note with the given title and content.
	 * Returns the generated UUID immediately.
	 */
	async createNote(title: string, content: string, type: NoteType = 'md'): Promise<string> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		console.log(`[FilenSync] Creating note "${title}"...`);
		const uuid = await this.sdk.notes().create({ title });

		try {
			await this.sdk.notes().changeType({ uuid, newType: type });
		} catch (e) {
			// Ignore if it fails here, fallback to retryEdit
		}

		const safeContent = content && content.trim().length > 0 ? content : 'Initial Content';

		await this.retryEdit(
			() => this.sdk!.notes().edit({ uuid, content: safeContent, type }),
			uuid,
			'initial content'
		);

		return uuid;
	}

	/** Update the content of an existing remote note. */
	async updateNoteContent(uuid: string, content: string, type: NoteType = 'md'): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		const safeContent = content && content.trim().length > 0 ? content : 'Initial Content';
		await this.retryEdit(
			() => this.sdk!.notes().edit({ uuid, content: safeContent, type }),
			uuid,
			'content update'
		);
	}

	/** Update the displayed title of an existing remote note. */
	async updateNoteTitle(uuid: string, title: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		await this.sdk.notes().editTitle({ uuid, title });
	}

	/** Move a note to trash. */
	async trashNote(uuid: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		await this.sdk.notes().trash({ uuid });
	}

	/** Permanently delete a note. */
	async deleteNote(uuid: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		await this.sdk.notes().delete({ uuid });
	}

	// ────────────────────────────────
	//  FS API (binary attachments)
	// ────────────────────────────────

	/** Get or create the base directory on Filen Drive. */
	async ensureVaultRoot(): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			await this.sdk.fs().mkdir({ path: this.vaultRootPath });
		} catch (e) {
			// Already exists — fine
		}
	}

	/** Upload a local file to Filen Drive, preserving its vault-relative path. */
	async uploadAttachment(localPath: string): Promise<{ uuid: string; name: string }> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		await this.ensureVaultRoot();

		// Build the remote folder path, e.g. /obsidian-bridge/vault/attachments
		const remoteDir = path.posix.join(this.vaultRootPath, path.posix.dirname(localPath));
		await this.sdk.fs().mkdir({ path: remoteDir });

		const fileName = path.posix.basename(localPath);

		// Construct absolute local path (Obsidian vault root + relative path)
		const vaultRoot = (this.plugin.app.vault.adapter as any).basePath;
		const absoluteSource = path.join(vaultRoot, localPath);

		console.log(`[FilenSync] Uploading attachment: ${localPath} -> ${remoteDir}/${fileName}`);

		const buffer = fs.readFileSync(absoluteSource);
		const remotePath = path.posix.join(remoteDir, fileName);

		const item = await this.sdk.fs().writeFile({
			path: remotePath,
			content: buffer,
		});

		return { uuid: item.uuid, name: fileName };
	}

	/** Download a file from Filen Drive to a local temp path, returning the path. */
	async downloadAttachment(uuid: string): Promise<Buffer> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		// Get file metadata from the FS tree
		const stat = await this.sdk.fs().stat({ path: 'temporary' }); // We need another approach
		// Actually, use the cloud download directly via a temp file
		const tmpDir = path.join(os.tmpdir(), 'obsidian-filen-plugin', 'downloads');
		fs.mkdirSync(tmpDir, { recursive: true });
		const tmpPath = path.join(tmpDir, uuid);

		// Use the FS readFile which handles decryption
		// But we need the path first... Let's use a different approach.
		// The FS module tracks items by path. We'll use the cloud download directly.
		// Since we have the UUID, we need bucket/region/chunks/key from metadata.
		// For simplicity, let's use a known path approach.
		throw new Error('Use downloadAttachmentByPath instead');
	}

	/** Download an attachment given its remote FS path, returning the raw buffer. */
	async downloadAttachmentBuffer(remotePath: string): Promise<Buffer> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		const buffer = await this.sdk.fs().readFile({ path: remotePath });
		return buffer;
	}

	/** Upload a buffer as a new file at the given remote FS path. */
	async uploadAttachmentBuffer(remotePath: string, content: Buffer): Promise<string> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		const dir = path.posix.dirname(remotePath);
		await this.sdk.fs().mkdir({ path: dir });

		const item = await this.sdk.fs().writeFile({
			path: remotePath,
			content,
		});

		return item.uuid;
	}

	/** Delete a file at the given remote FS path. */
	async deleteAttachment(remotePath: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			await this.sdk.fs().unlink({ path: remotePath });
		} catch (e) {
			console.warn(`[FilenSync] Failed to delete attachment at ${remotePath}:`, e);
		}
	}

	/** Read a JSON file from Filen Drive. */
	async readFSJson<T>(remotePath: string): Promise<T | null> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			const buffer = await this.sdk.fs().readFile({ path: remotePath });
			return JSON.parse(buffer.toString('utf-8')) as T;
		} catch (e) {
			return null;
		}
	}

	/** Write a JSON object to Filen Drive. */
	async writeFSJson(remotePath: string, data: unknown): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		const dir = path.posix.dirname(remotePath);
		await this.sdk.fs().mkdir({ path: dir });
		const content = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
		await this.sdk.fs().writeFile({ path: remotePath, content });
	}

	// ────────────────────────────────
	//  CLOUD-BACKED NOTE INDEX
	// ────────────────────────────────

	get indexRemotePath(): string {
		return path.posix.join(this.vaultRootPath, 'note-index.json');
	}

	/** Pull the note index from Filen Drive. */
	async pullNoteIndex(): Promise<Record<string, string> | null> {
		return this.readFSJson<Record<string, string>>(this.indexRemotePath);
	}

	/** Push the current note index to Filen Drive. */
	async pushNoteIndex(index: Record<string, string>): Promise<void> {
		await this.writeFSJson(this.indexRemotePath, index);
	}

	// ────────────────────────────────
	//  HELPERS
	// ────────────────────────────────

	/**
	 * Retry an edit operation with exponential backoff.
	 */
	private async retryEdit(
		operation: () => Promise<void>,
		uuid: string,
		label: string
	): Promise<void> {
		const maxAttempts = 6;
		let lastErr: Error | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await operation();
				console.log(`[FilenSync] ${label} succeeded for ${uuid} (attempt ${attempt})`);
				return;
			} catch (err: any) {
				lastErr = err;
				const msg = err?.message || String(err);
				console.log(`[FilenSync] ${label} attempt ${attempt} failed with error:`, msg);

				if (
					(msg.includes('Note not found') || msg.includes('not found')) &&
					attempt < maxAttempts
				) {
					const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
					console.log(
						`[FilenSync] ${label} for ${uuid} not ready, ` +
						`retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`
					);
					await new Promise(r => setTimeout(r, delay));
				} else {
					throw err;
				}
			}
		}

		throw lastErr || new Error(`Failed to ${label} for ${uuid} after ${maxAttempts} attempts`);
	}
}