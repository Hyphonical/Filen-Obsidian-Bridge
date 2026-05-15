import { PluginSettingTab, App, Setting, ButtonComponent } from 'obsidian';
import type FilenSyncPlugin from '../main';
import { FilenLoginModal } from '../auth/login-modal';

export class FilenSettingTab extends PluginSettingTab {
	private plugin: FilenSyncPlugin;
	private authButton: ButtonComponent;
	private authDesc: HTMLElement;
	private pullButton: ButtonComponent;
	private pushButton: ButtonComponent;

	constructor(app: App, plugin: FilenSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Filen Sync' });

		// ── Vault Name ──
		new Setting(containerEl)
			.setName('Sync folder name')
			.setDesc('This vault is isolated on Filen Drive under this name. Change it only if you want to sync a vault across devices with different local folder names.')
			.addText(text => text
				.setPlaceholder('auto-detected')
				.setValue(this.plugin.settings.vaultName)
				.onChange(async (value) => {
					this.plugin.settings.vaultName = value.trim() || this.app.vault.getName();
					await this.plugin.saveSettings();
				}));

		// ── Authentication ──
		const authSetting = new Setting(containerEl)
			.setName('Authentication')
			.setDesc('Connect your Filen account to sync notes end-to-end encrypted.');

		authSetting.addButton(button => {
			this.authButton = button;
			this.authButton.onClick(() => {
				if (this.plugin.authManager.isAuthenticated) {
					void this.handleLogout();
				} else {
					this.handleLogin();
				}
			});
			this.refreshAuthButton();
			return button;
		});

		this.authDesc = containerEl.createDiv();
		this.authDesc.style.marginTop = '12px';
		this.authDesc.style.marginBottom = '24px';
		this.authDesc.style.color = 'var(--text-muted)';
		this.refreshAuthDesc();

		// ── Pull / Force Sync ──
		containerEl.createEl('h3', { text: 'Sync Actions' });

		new Setting(containerEl)
			.setName('Pull vault from Filen')
			.setDesc('Download all files and folders from your Filen Drive that are newer than your local copies. Use this when setting up a new device or restoring your vault.')
			.addButton(button => {
				this.pullButton = button;
				this.pullButton
					.setButtonText('Pull now')
					.setCta()
					.onClick(() => {
						void this.handlePull();
					});
				return button;
			});

		new Setting(containerEl)
			.setName('Force pull (overwrite)')
			.setDesc('Overwrite ALL local files with the versions stored in Filen Drive. This will replace any local changes that haven\'t been synced yet. Use with caution.')
			.addButton(button => button
				.setButtonText('Force pull')
				.setWarning()
				.onClick(() => {
					void this.handleForcePull();
				}));

		new Setting(containerEl)
			.setName('Push vault to Filen')
			.setDesc('Upload all local files that are newer or missing on Filen Drive. Useful to force a full sync without waiting for the debounce timer.')
			.addButton(button => {
				this.pushButton = button;
				this.pushButton
					.setButtonText('Push now')
					.setCta()
					.onClick(() => {
						void this.handlePush();
					});
				return button;
			});

		// ── Sync Engine ──
		containerEl.createEl('h3', { text: 'Sync Engine' });

		new Setting(containerEl)
			.setName('Fast sync delay (s)')
			.setDesc('How long to wait after you stop typing before syncing (debounce delay).')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.fastDelayMs / 1000))
				.onChange(async (value) => {
					const parsed = parseFloat(value);
					if (!isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.fastDelayMs = Math.round(parsed * 1000);
						await this.plugin.saveSettings();
						this.plugin.syncEngine.updateTimers();
					}
				}));

		new Setting(containerEl)
			.setName('Force sync delay (s)')
			.setDesc('Maximum time to wait before forcing a sync, even if you are still typing.')
			.addText(text => text
				.setPlaceholder('10')
				.setValue(String(this.plugin.settings.forceDelayMs / 1000))
				.onChange(async (value) => {
					const parsed = parseFloat(value);
					if (!isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.forceDelayMs = Math.round(parsed * 1000);
						await this.plugin.saveSettings();
						this.plugin.syncEngine.updateTimers();
					}
				}));

		new Setting(containerEl)
			.setName('Poll interval (s)')
			.setDesc('How often to check Filen Drive for remote changes. Set to 0 to disable automatic polling (you will need to pull manually).')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.pollIntervalSec))
				.onChange(async (value) => {
					const parsed = parseFloat(value);
					if (!isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.pollIntervalSec = Math.round(parsed);
						await this.plugin.saveSettings();
						this.plugin.syncEngine.updateTimers();
					}
				}));
	}

	// ── Button logic ──

	private refreshAuthButton(): void {
		const isAuth = this.plugin.authManager.isAuthenticated;
		this.authButton.setButtonText(isAuth ? 'Logout' : 'Login');
		this.authButton.buttonEl.classList.toggle('mod-cta', !isAuth);
	}

	private refreshAuthDesc(): void {
		const isAuth = this.plugin.authManager.isAuthenticated;
		this.authDesc.setText(
			isAuth
				? 'Connected to Filen. Your session is persisted in this vault.'
				: 'Not connected. Click Login to enter your Filen credentials.'
		);
	}

	private handleLogin(): void {
		new FilenLoginModal(this.app, async (email, password, twoFactor) => {
			await this.plugin.authManager.login(email, password, twoFactor || undefined);
			this.refreshAuthButton();
			this.refreshAuthDesc();
			this.plugin.refreshStatusBar();
			// Auto-pull after fresh login
			setTimeout(() => {
				void this.plugin.syncEngine.pullAll(false);
			}, 2000);
		}).open();
	}

	private async handleLogout(): Promise<void> {
		await this.plugin.authManager.logout();
		this.refreshAuthButton();
		this.refreshAuthDesc();
		this.plugin.refreshStatusBar();
	}

	private async handlePull(): Promise<void> {
		if (!this.plugin.authManager.isAuthenticated) {
			this.authDesc.setText('Please log in first.');
			return;
		}
		this.pullButton?.setButtonText('Pulling...');
		this.pullButton?.setDisabled(true);
		try {
			await this.plugin.syncEngine.pullAll(false);
		} finally {
			this.pullButton?.setButtonText('Pull now');
			this.pullButton?.setDisabled(false);
		}
	}

	private async handleForcePull(): Promise<void> {
		if (!this.plugin.authManager.isAuthenticated) {
			this.authDesc.setText('Please log in first.');
			return;
		}
		await this.plugin.syncEngine.pullAll(true);
	}

	private async handlePush(): Promise<void> {
		if (!this.plugin.authManager.isAuthenticated) {
			this.authDesc.setText('Please log in first.');
			return;
		}
		this.pushButton?.setButtonText('Pushing...');
		this.pushButton?.setDisabled(true);
		try {
			await this.plugin.syncEngine.pushAll();
		} finally {
			this.pushButton?.setButtonText('Push now');
			this.pushButton?.setDisabled(false);
		}
	}
}