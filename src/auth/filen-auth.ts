import { FilenSDK } from '@filen/sdk';
import { Notice } from 'obsidian';
import type FilenSyncPlugin from '../main';
import { FilenSession } from '../types';

/**
 * Encapsulates Filen SDK lifecycle: login, session persistence, and logout.
 */
export class FilenAuthManager {
	private plugin: FilenSyncPlugin;
	private _sdk: FilenSDK | null = null;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
	}

	/** Expose the underlying SDK instance (null when logged out). */
	get sdk(): FilenSDK | null {
		return this._sdk;
	}

	/** Whether we currently hold an active session. */
	get isAuthenticated(): boolean {
		return this._sdk !== null;
	}

	/**
	 * Attempts to restore a previous session from plugin settings
	 * without asking for the password again.
	 */
	async initializeFromSavedSession(): Promise<boolean> {
		const session = this.plugin.settings.session;
		if (!session) return false;

		try {
			this._sdk = new FilenSDK({
				metadataCache: true,
				connectToSocket: true,
				masterKeys: session.masterKeys,
				apiKey: session.apiKey,
				publicKey: session.publicKey,
				privateKey: session.privateKey,
				authVersion: session.authVersion as any,
				baseFolderUUID: session.baseFolderUUID,
				userId: session.userId,
			});

			return true;
		} catch (error) {
			console.error('[FilenSync] Failed to restore session:', error);
			this._sdk = null;
			return false;
		}
	}

	/**
	 * Authenticates with Filen using email + password + optional 2FA.
	 * The SDK's login() method re-initializes itself internally with all derived keys.
	 * We read them from the public `config` property afterwards.
	 */
	async login(email: string, password: string, twoFactorCode?: string): Promise<void> {
		const sdk = new FilenSDK({
			metadataCache: true,
			connectToSocket: true,
		});

		await sdk.login({
			email,
			password,
			twoFactorCode: twoFactorCode || undefined,
		});

		// After login(), sdk.config holds everything we need to restore the session.
		const cfg = (sdk as any).config as {
			masterKeys?: string[];
			apiKey?: string;
			publicKey?: string;
			privateKey?: string;
			authVersion?: number;
			userId?: number;
			baseFolderUUID?: string;
		};

		const session: FilenSession = {
			masterKeys: cfg.masterKeys ?? [],
			apiKey: cfg.apiKey ?? '',
			publicKey: cfg.publicKey ?? '',
			privateKey: cfg.privateKey ?? '',
			authVersion: cfg.authVersion ?? 2,
			userId: cfg.userId ?? 0,
			baseFolderUUID: cfg.baseFolderUUID ?? '',
		};

		this._sdk = sdk;
		this.plugin.settings.session = session;
		await this.plugin.saveSettings();

		new Notice('Filen: Logged in successfully');
	}

	/** Clears the active session from memory and disk. */
	async logout(): Promise<void> {
		this._sdk = null;
		this.plugin.settings.session = null;
		await this.plugin.saveSettings();
		new Notice('Filen: Logged out');
	}
}