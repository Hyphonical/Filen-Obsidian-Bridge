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
			// @ts-ignore
			this.app.setting.open();
			// @ts-ignore
			this.app.setting.openTabById(this.manifest.id);
		});
		this.refreshStatusBar();

		if (restored) {
			console.log('[FilenSync] Session restored from saved credentials.');
			// Initial pull + start background polling
			setTimeout(() => {
				void this.syncEngine.pullAll(false);
				this.syncEngine.startPolling();
			}, 3000);
		}
	}

	onunload(): void {
		this.vaultListener?.stop();
		this.syncEngine?.destroy();
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
		let text = isAuth ? 'Filen: Connected' : 'Filen: Disconnected';
		if (this._statusMessage) {
			text = `Filen: ${this._statusMessage}`;
		}
		this.statusBarItemEl.setText(text);
		this.statusBarItemEl.title = isAuth
			? 'Click to manage Filen Sync settings'
			: 'Click to log in to Filen';
	}
}