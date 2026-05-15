import { TAbstractFile, TFile } from 'obsidian';
import type FilenSyncPlugin from '../main';
import { FilenSyncEngine } from '../sync/sync-engine';

/**
 * Subscribes to Obsidian vault events and translates them into sync operations.
 * Tracks both markdown notes (.md) and attachment files (configured extensions).
 * Delays registration until layout is ready to avoid flooding on vault load.
 */
export class VaultListener {
	private plugin: FilenSyncPlugin;
	private engine: FilenSyncEngine;
	private handlers: any[] = [];
	private _paused = false;

	constructor(plugin: FilenSyncPlugin, engine: FilenSyncEngine) {
		this.plugin = plugin;
		this.engine = engine;
	}

	/** Start listening after Obsidian has finished loading the workspace. */
	start(): void {
		this.app.workspace.onLayoutReady(() => {
			this.registerEventHandlers();
		});
	}

	/** 
	 * Pause the listener — all vault events are silently dropped.
	 * Used during pull cycles to prevent feedback loops.
	 */
	pause(): void {
		this._paused = true;
	}

	/** Resume listening for vault events. */
	resume(): void {
		this._paused = false;
	}

	/** Whether the listener is currently paused. */
	get isPaused(): boolean {
		return this._paused;
	}

	/** Unsubscribe all vault event listeners. */
	stop(): void {
		for (const ref of this.handlers) {
			this.plugin.app.vault.offref(ref);
		}
		this.handlers = [];
	}

	private registerEventHandlers(): void {
		const vault = this.plugin.app.vault;

		this.handlers.push(
			vault.on('create', (file: TAbstractFile) => {
				if (!this._paused && this.shouldTrack(file)) {
					this.engine.queue({ type: 'CREATE', path: file.path });
				}
			})
		);

		this.handlers.push(
			vault.on('modify', (file: TAbstractFile) => {
				if (!this._paused && this.shouldTrack(file)) {
					this.engine.queue({ type: 'MODIFY', path: file.path });
				}
			})
		);

		this.handlers.push(
			vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (!this._paused && this.shouldTrack(file)) {
					this.engine.queue({ type: 'RENAME', path: oldPath, newPath: file.path });
				}
			})
		);

		this.handlers.push(
			vault.on('delete', (file: TAbstractFile) => {
				if (!this._paused && this.shouldTrack(file)) {
					this.engine.queue({ type: 'DELETE', path: file.path });
				}
			})
		);
	}

	/** Whether a file should be synced. True for markdown notes and all other files (saved to Filen FS). */
	private shouldTrack(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		return true; // We now track everything
	}

	private get app() {
		return this.plugin.app;
	}
}
