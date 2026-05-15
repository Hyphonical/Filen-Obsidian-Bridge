import { FilenSession } from './types';

export interface PluginSettings {
	/** Persisted Filen session; null when logged out. */
	session: FilenSession | null;
	/** The vault name used to isolate this vault on Filen Drive.
	 *  Defaults to the actual Obsidian vault name. Can be overridden
	 *  by the user when they want to sync the same logical vault across
	 *  devices that have different local folder names. */
	vaultName: string;
	/** Delay in milliseconds before executing a batch of changes (idle debounce). */
	fastDelayMs: number;
	/** Maximum delay in milliseconds before forcing a sync, regardless of typing. */
	forceDelayMs: number;
	/** Timestamp of the last successful pull from Filen. */
	lastPullTimestamp: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	session: null,
	vaultName: '',
	fastDelayMs: 2000,
	forceDelayMs: 10000,
	lastPullTimestamp: 0,
};
