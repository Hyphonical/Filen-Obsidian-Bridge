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
- **Periodic Pulling** — Checks Filen Drive every N seconds for remote changes (configurable, default 2s). Remote changes appear automatically.
- **Latest-Wins Conflict Strategy** — When a file exists both locally and remotely, the version with the newest modification time wins (same as Dropbox/Syncthing).
- **Push / Pull Controls** — Manually push any unsynced local files or pull the latest from Filen with one click.

---

## Prerequisites

- Obsidian Desktop (v1.0.0 or later)
- A [Filen.io](https://filen.io/) account

---

## Installation

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Hyphonical/filen-obsidian-bridge/releases).
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

## How Syncing Works

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
