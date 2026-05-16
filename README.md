# Filen Bridge for Obsidian

Use [Filen](https://filen.io/) as encrypted, zero-knowledge cloud sync for your **entire Obsidian vault** — notes, canvas files, images, PDFs, plugins, themes, and settings.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-green.svg)

> **Note:** This plugin currently requires Obsidian Desktop. Mobile support is planned for the future.

---

## Features

- **Full Vault Sync** — Every file in your vault is synced: `.md` notes, `.canvas` files, images, PDFs, your `.obsidian` config folder (plugins, themes, settings), and any other attachments.
- **Folder Structure Preserved** — Make a folder with two notes on one device, pull on another, and the exact same folder structure is restored.
- **Zero-Knowledge Encryption** — All files are encrypted client-side using the Filen SDK before they ever leave your machine. Only you hold the keys.
- **Vault Isolation** — Each vault gets its own isolated folder on Filen Drive (named after the vault), so multiple vaults never collide.
- **Event-Driven Sync** — Watches for file changes in the background, debounces rapid edits, and pushes automatically when you stop typing.
- **Real-Time Pull** — Uses Filen's WebSocket to receive push notifications for remote changes. Files appear on your device within seconds — no polling needed.
- **Latest-Wins Conflict Strategy** — When a file exists both locally and remotely, the version with the newest modification time wins (same as Dropbox/Syncthing).
- **Push / Pull Controls** — Manually push any unsynced local files or pull the latest from Filen with one click.

---

## Prerequisites

- Obsidian Desktop (v1.4.0 or later)
- A [Filen.io](https://filen.io/) account

---

## Installation

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. In your vault, create `.obsidian/plugins/filen-bridge/` and place the files there.
3. Restart Obsidian, go to **Settings → Community plugins**, and enable **Filen Bridge**.

### Via BRAT
1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Add the repository: `Hyphonical/filen-obsidian-bridge`
3. Enable **Filen Bridge** in Community Plugins.

---

## Setup & Usage

1. Open **Settings → Filen Bridge**.
2. Click **Login** and enter your Filen credentials (email + password, and 2FA code if enabled).
3. Your vault name is auto-detected as the sync folder. You can change it in settings if different devices use different local folder names.
4. Once connected, the plugin automatically syncs changes. The status bar shows what's happening.

### Manual actions
| Button | What it does |
|--------|-------------|
| **Pull now** | Downloads any files from Filen Drive that are newer than your local copies. |
| **Force pull** | Overwrites ALL local files with the Filen versions — use with caution. |
| **Push now** | Uploads every local file that doesn't exist on Filen or is newer than the remote copy. |

---

## Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| **Sync folder name** | Auto-detected from vault name | Isolates this vault on Filen Drive. Change only if devices use different local folder names. |
| **Fast sync delay** | 2s | How long to wait after you stop typing before pushing changes. |
| **Force sync delay** | 10s | Maximum wait before pushing, even if you're still typing. |
| **Ignore patterns** | *(empty)* | Newline-separated glob patterns for files/folders to exclude from sync. |

---

## How Syncing Works (in Detail)

The plugin uses a **debounce + force-flush + real-time socket** model:

1. **You edit a file** → A `MODIFY` operation is queued. Each new keystroke resets the **fast sync timer** (default 2s).
2. **The fast timer expires** (you stopped typing) → All queued operations are **deduplicated** and **flushed** to Filen Drive in one batch.
3. **Force timer expires** (default 10s) → Flushes regardless of whether you're still typing — ensures changes are never held indefinitely.
4. **You delete/rename a file** → The operation is immediately queued. Before any pull, the pending queue is **drained** so the old file cannot "resurrect."
5. **Real-time socket events** → Filen's WebSocket notifies the plugin instantly when files change on another device. The plugin debounces these (1s cooldown) and pulls the latest versions.
6. **Vault listener is paused during pull cycles** → Prevents feedback loops where a pulled file triggers an upload.

```
User edits ──→ queue("MODIFY") ──→ fast timer reset
                                      │
          ┌───────────────────────────┘
          ▼
   fast timer expires (2s idle)
          │
          ▼
    deduplicate queue ──→ flush to Filen Drive

Filen WebSocket:
    socketEvent.file.new ─────┐
    socketEvent.file.rename ──┤──→ (1s debounce) ──→ drain pending ──→ pull changes
    socketEvent.file.delete ──┘
```

The plugin mirrors your vault folder tree directly onto Filen Drive under `.obsidian/{vault-name}/`. Every file type is treated identically — no special Notes API, no UUID mappings, no metadata files.

```
Filen Drive
└── .obsidian/
    └── MyVault/          ← your vault name
        ├── daily/
        │   └── note.md
        ├── projects/
        │   └── idea.canvas
        ├── attachments/
        │   └── photo.png
        └── .obsidian/    ← your Obsidian config
            ├── app.json
            ├── plugins/
            └── themes/
```

- **CREATE/MODIFY** → uploaded to Filen Drive.
- **RENAME** → moved on Filen Drive (including entire folders).
- **DELETE** → removed from Filen Drive.
- **PULL** → any remote files newer than your local ones are downloaded.

Filen Drive handles file versioning natively, so you get history "for free" just by re-uploading.

---

## Cross-Device Setup

To sync the same vault across two computers:

1. Install the plugin on both devices.
2. On the first device, log in and let the initial sync complete.
3. On the second device, log in and click **Pull now** under Sync Actions.
4. Make sure both devices use the same **Sync folder name** in settings. By default this is auto-detected from the vault folder name — if your vault is named `MyVault` on both, it just works.

---

## Limitations

- **Requires WebSocket connectivity** — Real-time sync depends on Filen's WebSocket staying connected. If your network blocks WebSockets, you can still use manual Push/Pull.
- **No merge conflict resolution** — If both sides modify the same file before syncing, the version with the **newest modification time wins** (latest-wins strategy). No three-way merge.
- **No selective sync** — The entire vault is synced as one unit. You can exclude files via ignore patterns, but there's no per-folder one-way sync.
- **Desktop only** — Mobile support is planned for the future.

---

## Troubleshooting

### "Why did my deleted file come back?"

The plugin **drains all pending local operations before every pull** — this means if you delete or rename a file, your change is synced to Filen Drive *before* any remote changes are downloaded. This prevents resurrection.

If the issue persists:
- Manually click **Push now** after deleting files to force an immediate upload of the deletion.
- Check that the file isn't being recreated by another plugin on startup.
- Verify the WebSocket connection is stable (status bar shows "Connected").

### "Push now" vs "Pull now" — what should I use?

- **Push now**: I've added files on this device and want them on Filen *right now*.
- **Pull now**: I expect changes from another device and want them locally *right now*.
- **Force pull**: Overwrite ALL local files with remote versions. Use when you've made accidental local changes you want to discard.

### "I'm not seeing changes from my other device"

Real-time sync uses Filen's WebSocket. If changes aren't appearing:
- Check the status bar — it should show **Filen: ● Live** when connected. If it shows **Filen: ◌ Socket**, the WebSocket isn't connected.
- Click **Pull now** to force a manual sync.
- Verify your network isn't blocking WebSocket connections.
- Check [Filen's status page](https://status.filen.io/) for service outages.

### "The sync folder name changed unexpectedly"

The sync folder name auto-detects from your vault name. If you rename your vault folder, you may need to update the **Sync folder name** in settings to match. Otherwise, the plugin will create a new folder on Filen Drive (your old data is still there under the old name).

---

## Roadmap

- [x] Real-time sync via Filen WebSocket events (no polling latency)
- [x] WebSocket connection health indicator in status bar
- [ ] Conflict resolution UI (side-by-side diff for conflicted files)
- [ ] Selective folder sync (one-way, exclude)
- [ ] Sync statistics and activity log
- [ ] Context menu integration (right-click → sync/exclude)
- [ ] Mobile support

---

## Building from Source

```bash
npm install
npm run build
```

---

## Contributing

Pull requests are welcome! Please open an issue first to discuss what you'd like to change.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
