import { FilenSession } from './types';

export interface PluginSettings {
	/** Persisted Filen session; null when logged out. */
	session: FilenSession | null;
	/** The vault name used to isolate this vault on Filen Drive. */
	vaultName: string;
	/** Delay in milliseconds before executing a batch of changes (idle debounce). */
	fastDelayMs: number;
	/** Maximum delay in milliseconds before forcing a sync, regardless of typing. */
	forceDelayMs: number;
	/** Newline-separated list of wildcard patterns to ignore (e.g., node_modules\/*). */
	ignorePatterns: string;
	// ── Developer settings ──
	/** Cooldown in ms to ignore socket echoes after a local upload. */
	socketCooldownMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	session: null,
	vaultName: '',
	fastDelayMs: 1000,
	forceDelayMs: 10000,
	ignorePatterns: '',
	socketCooldownMs: 1000,
};
