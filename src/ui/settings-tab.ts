import { PluginSettingTab, App, Setting, ButtonComponent, Modal } from 'obsidian';
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

		// ── Sync Actions ──
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

		// ── Ignore Patterns ──
		containerEl.createEl('h3', { text: 'Ignore Patterns' });

		new Setting(containerEl)
			.setName('Files to ignore')
			.setDesc('Newline-separated list of paths to exclude from syncing. Supports basic wildcards (e.g., "node_modules/*", ".env", "*.tmp").')
			.addTextArea(text => {
				text.inputEl.style.minHeight = '100px';
				text.inputEl.style.minWidth = '300px';
				text
					.setPlaceholder('node_modules/*\n.env\n*.tmp')
					.setValue(this.plugin.settings.ignorePatterns)
					.onChange(async (value) => {
						this.plugin.settings.ignorePatterns = value;
						await this.plugin.saveSettings();
					});
			});

		// ── Developer Settings (collapsible) ──
		const devDetails = containerEl.createEl('details');
		const devSummary = devDetails.createEl('summary');
		devSummary.textContent = 'Developer Settings';
		devSummary.style.marginTop = '24px';
		devSummary.style.cursor = 'pointer';
		devSummary.style.fontWeight = 'var(--bold-weight)';

		new Setting(devDetails)
			.setName('Socket cooldown (ms)')
			.setDesc('How long to ignore socket echo events after a local upload, to prevent self-triggered pull loops.')
			.addText(text => text
				.setPlaceholder('1000')
				.setValue(String(this.plugin.settings.socketCooldownMs))
				.onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (!isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.socketCooldownMs = parsed;
						await this.plugin.saveSettings();
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
		const socketOk = this.plugin.syncEngine?.socketConnected ?? false;
		this.authDesc.setText(
			isAuth
				? socketOk
					? 'Connected to Filen. Real-time sync active via WebSocket. Your session is persisted in this vault.'
					: 'Connected to Filen but WebSocket is not connected. Real-time updates are unavailable — use manual Pull.'
				: 'Not connected. Click Login to enter your Filen credentials.'
		);
	}

	private handleLogin(): void {
		new FilenLoginModal(this.app, async (email, password, twoFactor) => {
			await this.plugin.authManager.login(email, password, twoFactor || undefined);
			this.refreshAuthButton();
			this.refreshAuthDesc();
			this.plugin.refreshStatusBar();
			// Start socket listeners + initial pull after fresh login
			this.plugin.syncEngine.start();
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

		// Confirm destructive action
		const confirmed = await new Promise<boolean>((resolve) => {
			const modal = new ConfirmModal(this.app, resolve);
			modal.open();
		});

		if (!confirmed) return;

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

class ConfirmModal extends Modal {
	private resolve: (value: boolean) => void;

	constructor(app: App, resolve: (value: boolean) => void) {
		super(app);
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText('Force Pull?');
		contentEl.createEl('p', {
			text: 'This will overwrite ALL local files with the versions from Filen Drive. Any local changes that haven\'t been synced will be lost. Are you sure?',
		});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => {
					this.resolve(false);
					this.close();
				}))
			.addButton(btn => btn
				.setButtonText('Force Pull')
				.setWarning()
				.onClick(() => {
					this.resolve(true);
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}