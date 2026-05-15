import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type FilenSyncPlugin from '../main';

/**
 * Pure Filen Drive (FS API) client.
 *
 * All files — notes, attachments, canvas, config — are treated uniformly
 * as files within a vault-specific subfolder on Filen Drive:
 *
 *   .obsidian/{vault-name}/
 *   ├── Notes/
 *   ├── attachments/
 *   ├── .obsidian/          ← Obsidian's own config folder
 *   └── ...
 *
 * No UUID tracking needed — the folder tree IS the index.
 */
export class FilenDriveClient {
	private plugin: FilenSyncPlugin;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
	}

	private get sdk() {
		return this.plugin.authManager.sdk;
	}

	/** Whether we have an authenticated SDK ready. */
	get isReady(): boolean {
		return this.sdk !== null;
	}

	// ────────────────────────────────
	//  PATH HELPERS
	// ────────────────────────────────

	/** 
	 * The vault-isolated root path on Filen Drive.
	 * e.g. ".obsidian/MyVault" 
	 */
	get vaultRootPath(): string {
		const vaultName = this.plugin.settings.vaultName || 'default-vault';
		return `.obsidian/${vaultName}`;
	}

	/** 
	 * Convert a local vault-relative path to the remote Filen Drive path.
	 * e.g. "Notes/daily.md" → ".obsidian/MyVault/Notes/daily.md"
	 */
	localToRemote(localPath: string): string {
		return path.posix.join(this.vaultRootPath, localPath);
	}

	/** 
	 * Convert a remote Filen Drive path back to a vault-relative path.
	 * e.g. ".obsidian/MyVault/Notes/daily.md" → "Notes/daily.md"
	 */
	remoteToLocal(remotePath: string): string {
		const prefix = this.vaultRootPath + '/';
		if (remotePath.startsWith(prefix)) {
			return remotePath.slice(prefix.length);
		}
		return remotePath;
	}

	// ────────────────────────────────
	//  VAULT ROOT SETUP
	// ────────────────────────────────

	/** Ensure the vault root directory exists on Filen Drive. */
	async ensureVaultRoot(): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			await this.sdk.fs().mkdir({ path: this.vaultRootPath });
		} catch (_e) {
			// Already exists — fine
		}
	}

	// ────────────────────────────────
	//  FILE OPERATIONS
	// ────────────────────────────────

	/**
	 * Upload a file from the local vault to Filen Drive.
	 * Reads the file from disk, creates intermediate remote directories,
	 * and writes the encrypted buffer.
	 */
	async uploadFile(localPath: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		const remotePath = this.localToRemote(localPath);
		const remoteDir = path.posix.dirname(remotePath);

		// Ensure remote directory structure exists
		await this.sdk.fs().mkdir({ path: remoteDir });

		// Read local file from disk
		const vaultRoot = (this.plugin.app.vault.adapter as any).basePath;
		const absoluteSource = path.join(vaultRoot, localPath);
		const buffer = fs.readFileSync(absoluteSource);

		console.log(`[FilenSync] Uploading: ${localPath} → ${remotePath}`);
		await this.sdk.fs().writeFile({
			path: remotePath,
			content: buffer,
		});
	}

	/**
	 * Download a file from Filen Drive and return its raw buffer.
	 */
	async downloadFile(remotePath: string): Promise<Buffer> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		const buffer = await this.sdk.fs().readFile({ path: remotePath });
		return buffer;
	}

	/**
	 * Delete a file from Filen Drive.
	 */
	async deleteFile(remotePath: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			await this.sdk.fs().unlink({ path: remotePath });
			console.log(`[FilenSync] Deleted remote: ${remotePath}`);
		} catch (e: any) {
			// File might not exist — don't crash
			console.warn(`[FilenSync] Could not delete ${remotePath}:`, e?.message || e);
		}
	}

	/**
	 * Delete a directory and all its contents from Filen Drive.
	 */
	async deleteDirectory(remotePath: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');
		try {
			await this.sdk.fs().rmdir({ path: remotePath });
			console.log(`[FilenSync] Deleted remote dir: ${remotePath}`);
		} catch (e: any) {
			console.warn(`[FilenSync] Could not delete dir ${remotePath}:`, e?.message || e);
		}
	}

	/**
	 * Rename/move a file on Filen Drive.
	 */
	async renameFile(oldRemotePath: string, newRemotePath: string): Promise<void> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		const newDir = path.posix.dirname(newRemotePath);
		await this.sdk.fs().mkdir({ path: newDir });

		try {
			await this.sdk.fs().rename({ from: oldRemotePath, to: newRemotePath });
			console.log(`[FilenSync] Renamed: ${oldRemotePath} → ${newRemotePath}`);
		} catch (e: any) {
			console.warn(`[FilenSync] Rename failed ${oldRemotePath} → ${newRemotePath}:`, e?.message || e);
		}
	}

	/** Check if a file or directory exists on Filen Drive. */
	async exists(remotePath: string): Promise<boolean> {
		if (!this.sdk) return false;
		try {
			await this.sdk.fs().stat({ path: remotePath });
			return true;
		} catch {
			return false;
		}
	}

	// ────────────────────────────────
	//  DIRECTORY LISTING
	// ────────────────────────────────

	/**
	 * Recursively list all file paths within the vault root on Filen Drive.
	 * Returns an array of vault-relative paths.
	 */
	async listAllFiles(): Promise<string[]> {
		if (!this.sdk) throw new Error('Filen SDK not initialized');

		try {
			await this.ensureVaultRoot();
			const allPaths = await this.sdk.fs().readdir({
				path: this.vaultRootPath,
				recursive: true,
			});

			// Convert remote paths to vault-relative paths
			return allPaths.map(p => this.remoteToLocal(p));
		} catch (e: any) {
			// Vault root may not exist yet — return empty
			console.warn('[FilenSync] Could not list vault root:', e?.message || e);
			return [];
		}
	}

	/**
	 * Get file stat (size, mtime, etc.) from Filen Drive.
	 */
	async stat(remotePath: string): Promise<{ size: number; mtime: number } | null> {
		if (!this.sdk) return null;
		try {
			const s = await this.sdk.fs().stat({ path: remotePath });
			return { size: s.size, mtime: s.mtimeMs };
		} catch {
			return null;
		}
	}
}
