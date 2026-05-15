import { FilenSession } from './types';

export interface PluginSettings {
    /** Persisted Filen session; null when logged out. */
    session: FilenSession | null;
    /** Local path -> Filen UUID mapping for synced notes. */
    noteIndex: Record<string, string>;
    /** Local path -> Filen file UUID mapping for synced attachments. */
    attachmentIndex: Record<string, string>;
    /** Delay in milliseconds before executing a batch of changes (idle debounce). */
    fastDelayMs: number;
    /** Maximum delay in milliseconds before forcing a sync, regardless of typing. */
    forceDelayMs: number;
    /** Timestamp of the last successful pull from Filen. */
    lastPullTimestamp: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    session: null,
    noteIndex: {},
    attachmentIndex: {},
    fastDelayMs: 2000,
    forceDelayMs: 10000,
    lastPullTimestamp: 0,
};
