import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PluginSettings } from './settings';
import { FilenAuthManager } from './auth/filen-auth';
import { FilenSettingTab } from './ui/settings-tab';
import { FilenSyncEngine } from './sync/sync-engine';
import { VaultListener } from './obsidian-bridge/vault-listener';

export default class FilenSyncPlugin extends Plugin {
	settings: PluginSettings;
	authManager: FilenAuthManager;
	syncEngine: FilenSyncEngine;
	vaultListener: VaultListener;
	private statusBarItemEl: HTMLElement | null = null;
	private _statusMessage = '';

	/** Set a transient status line (e.g. "Saving 3 files…"). */
	set statusMessage(msg: string) {
		this._statusMessage = msg;
		this.refreshStatusBar();
	}

	get statusMessage(): string {
		return this._statusMessage;
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// Auto-detect vault name on first load (can be changed in settings)
		if (!this.settings.vaultName) {
			this.settings.vaultName = this.app.vault.getName();
			await this.saveSettings();
		}

		this.authManager = new FilenAuthManager(this);
		const restored = await this.authManager.initializeFromSavedSession();

		this.syncEngine = new FilenSyncEngine(this);
		this.vaultListener = new VaultListener(this, this.syncEngine);
		this.vaultListener.start();

		this.addSettingTab(new FilenSettingTab(this.app, this));

		this.statusBarItemEl = this.addStatusBarItem();
		this.statusBarItemEl.classList.add('mod-clickable');
		this.statusBarItemEl.onClickEvent(() => {
			// @ts-expect-error - Internal Obsidian API for opening settings
			this.app.setting.open();
			// @ts-expect-error - Internal Obsidian API for opening settings
			this.app.setting.openTabById(this.manifest.id);
		});
		this.refreshStatusBar();

		if (restored) {
			console.log('[FilenSync] Session restored from saved credentials.');
			// Start socket listeners for real-time sync, then do an initial pull
			this.syncEngine.start();
			setTimeout(() => {
				void this.syncEngine.pullAll(false);
			}, 3000);
		}
	}

	onunload(): void {
		this.vaultListener?.stop();
		this.syncEngine?.destroy();

		// Clean up SDK socket to prevent stale connections on hot reload
		const sdk = this.authManager?.sdk;
		if (sdk && (sdk as any).socket) {
			(sdk as any).socket.disconnect();
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshStatusBar(): void {
		if (!this.statusBarItemEl) return;

		const isAuth = this.authManager.isAuthenticated;
		const socketOk = this.syncEngine?.socketConnected ?? false;

		let text: string;
		let title: string;

		if (!isAuth) {
			text = 'Filen: Disconnected';
			title = 'Click to log in to Filen';
		} else if (this._statusMessage) {
			text = `Filen: ${this._statusMessage}`;
			title = 'Click to manage Filen Sync settings';
		} else if (socketOk) {
			text = 'Filen: ● Live';
			title = 'Socket connected — real-time sync active. Click for settings.';
		} else {
			text = 'Filen: ◌ Socket';
			title = 'Socket disconnected — changes will sync on next manual pull. Click for settings.';
		}

		this.statusBarItemEl.setText(text);
		this.statusBarItemEl.title = title;
	}
}