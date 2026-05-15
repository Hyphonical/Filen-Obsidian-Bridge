import { Modal, App, Setting, ButtonComponent } from 'obsidian';

/**
 * Modal that collects Filen credentials (email, password, optional 2FA).
 */
export class FilenLoginModal extends Modal {
	private email = '';
	private password = '';
	private twoFactorCode = '';
	private onSubmit: (email: string, password: string, twoFactor: string) => Promise<void>;
	private statusEl: HTMLElement;
	private loginButton: ButtonComponent;

	constructor(
		app: App,
		onSubmit: (email: string, password: string, twoFactor: string) => Promise<void>
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('filen-login-modal');

		contentEl.createEl('h2', { text: 'Login to Filen' });

		// Email
		new Setting(contentEl)
			.setName('Email')
			.setDesc('Your Filen account email address')
			.addText(text => {
				text.setPlaceholder('you@example.com');
				text.inputEl.type = 'email';
				text.inputEl.style.width = '100%';
				text.onChange(value => {
					this.email = value.trim();
				});
			});

		// Password
		new Setting(contentEl)
			.setName('Password')
			.setDesc('Your Filen account password')
			.addText(text => {
				text.setPlaceholder('••••••••');
				text.inputEl.type = 'password';
				text.inputEl.style.width = '100%';
				text.onChange(value => {
					this.password = value;
				});
			});

		// 2FA (optional)
		new Setting(contentEl)
			.setName('Two-factor code')
			.setDesc('Optional — only fill this in if 2FA is enabled on your Filen account.')
			.addText(text => {
				text.setPlaceholder('000000');
				text.inputEl.type = 'text';
				text.inputEl.style.width = '100%';
				text.inputEl.maxLength = 6;
				text.onChange(value => {
					this.twoFactorCode = value.trim();
				});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.marginTop = '20px';

		new ButtonComponent(buttonContainer)
			.setButtonText('Cancel')
			.onClick(() => {
				this.close();
			});

		this.loginButton = new ButtonComponent(buttonContainer)
			.setButtonText('Login')
			.setCta()
			.onClick(() => {
				void this.doLogin();
			});

		// Enter key submits the form
		contentEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void this.doLogin();
			}
		});

		this.statusEl = contentEl.createDiv();
		this.statusEl.style.marginTop = '10px';
		this.statusEl.style.color = 'var(--text-error)';
	}

	private async doLogin(): Promise<void> {
		if (!this.email || !this.password) {
			this.setError('Email and password are required.');
			return;
		}

		this.setError('');
		this.loginButton.setDisabled(true);
		this.loginButton.setButtonText('Logging in...');

		try {
			await this.onSubmit(this.email, this.password, this.twoFactorCode);
			this.close();
		} catch (error: any) {
			this.loginButton.setDisabled(false);
			this.loginButton.setButtonText('Login');
			this.setError(error?.message || 'Login failed. Please check your credentials.');
		}
	}

	private setError(message: string): void {
		this.statusEl.setText(message);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}