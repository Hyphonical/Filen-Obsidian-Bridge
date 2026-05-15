import type FilenSyncPlugin from '../main';

/**
 * Manages the local vault path -> Filen UUID mapping.
 * All changes are persisted via the plugin's settings store.
 */
export class NoteIndex {
	private plugin: FilenSyncPlugin;

	constructor(plugin: FilenSyncPlugin) {
		this.plugin = plugin;
	}

	/** Look up a Filen UUID by local vault path. */
	getByPath(path: string): string | undefined {
		return this.plugin.settings.noteIndex[path];
	}

	/** Look up a local vault path by Filen UUID. */
	getByUUID(uuid: string): string | undefined {
		for (const [path, id] of Object.entries(this.plugin.settings.noteIndex)) {
			if (id === uuid) return path;
		}
		return undefined;
	}

	/** Register a new mapping and persist it. */
	set(path: string, uuid: string): void {
		this.plugin.settings.noteIndex[path] = uuid;
		void this.plugin.saveSettings();
	}

	/** Remove a mapping and persist. */
	remove(path: string): void {
		delete this.plugin.settings.noteIndex[path];
		void this.plugin.saveSettings();
	}

	/**
	 * Atomically move a mapping from one path to another.
	 * Safe to call even if the old path isn't tracked.
	 */
	rename(oldPath: string, newPath: string): void {
		const uuid = this.plugin.settings.noteIndex[oldPath];
		if (uuid) {
			delete this.plugin.settings.noteIndex[oldPath];
			this.plugin.settings.noteIndex[newPath] = uuid;
			void this.plugin.saveSettings();
		}
	}
}
