# Filen Bridge for Obsidian

Use [Filen](https://filen.io/) as encrypted, zero-knowledge cloud storage for your Obsidian notes with cross-device sync. 

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-green.svg)

> **Note:** This plugin currently only supports Obsidian Desktop.

## Features

- **Zero-Knowledge Encryption:** Everything synced is encrypted using Filen's client-side SDK. Only you control the keys.
- **Full File Tracking:** Automatically synchronizes markdown notes, canvas files, and all attachments to your Filen account. Anything inside your Obsidian vault is seamlessly backed up.
- **Event-Driven Sync:** Operates silently in the background, debouncing keystrokes and synchronizing notes quickly via incremental push.
- **Conflict Avoidance:** Retains local metadata mapping so newer conflicting versions don't overwrite your active edits during simultaneous changes.

## Prerequisites

- Obsidian Desktop (version 1.0.0 or later)
- A [Filen.io](https://filen.io/) account

## Installation

As this is an early beta, the plugin is installed manually or via BRAT. Proper community store integration may come later.

### Manual Installation
1. Go to the [Releases](https://github.com/Hyphonical/filen-obsidian-bridge/releases) page.
2. Download the `main.js`, `manifest.json`, and `styles.css` files from the latest release.
3. In your Obsidian vault folder, navigate to `.obsidian/plugins/` and create a folder named `filen-bridge`.
4. Place the downloaded files into that folder.
5. In Obsidian, go to **Settings > Community plugins**, refresh the plugin list, and enable **Filen Bridge**.

### Using Obsidian42 - BRAT
1. Ensure the BRAT community plugin is installed in Obsidian.
2. Tell BRAT to add the repository: `Hyphonical/filen-obsidian-bridge`
3. Turn on the plugin in your Community Plugins settings.

## Setup & Usage

1. Go to **Settings > Option > Filen Bridge** in Obsidian.
2. Click **Login** and authenticate using your Filen account details. Your encrypted keys are kept locally in the vault session.
3. Once logged in, the vault will begin communicating with your Filen account (using the `/.obsidian` sync namespace).
4. The plugin will track changes locally and push them incrementally right after you stop typing.
5. **UI Toolbar / Status:** You will notice status updates directly in the Obsidian lower-left corner indicating exactly what is being pushed to the cloud.

## Synchronisation Details
*  **Notes (`.md`)** are synchronized using the specialized Filen Notes SDK infrastructure for pure text eventual-consistency updates.
* **Canvas, PDFs, Images, and Other Metadata** are automatically dumped out into an invisible synchronization folder inside the Filen virtual file-system space, maintaining structure but handling heavier data natively.

## Building from Source

```bash
bun install
bun run build
```

## Contributing
Pull requests are welcome! If you're adapting feature fixes, please open an issue first to discuss what you want to change. Ensure you read up on standard `@filen/sdk` quirks via browser/desktop overlap limits.

## License
MIT License. See [LICENSE](LICENSE) for details.
