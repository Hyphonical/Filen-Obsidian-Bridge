import { PluginSettingTab, App, Setting, ButtonComponent } from 'obsidian';
import type FilenSyncPlugin from '../main';
import { FilenLoginModal } from '../auth/login-modal';

export class FilenSettingTab extends PluginSettingTab {
	private plugin: FilenSyncPlugin;
	private authButton: ButtonComponent;
	private authDesc: HTMLElement;
	private pullButton: ButtonComponent;

	constructor(app: App, plugin: FilenSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Filen Sync' });

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
			.setName('Pull notes from Filen')
			.setDesc('Download all notes and attachments from your Filen account that are newer than your local copies. Use this when setting up a new device or restoring your vault.')
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
			.setDesc('Overwrite ALL local notes and attachments with the versions stored in Filen. This will replace any local changes that haven\'t been synced yet. Use with caution.')
			.addButton(button => button
				.setButtonText('Force pull')
				.setWarning()
				.onClick(() => {
					void this.handleForcePull();
				}));

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
}