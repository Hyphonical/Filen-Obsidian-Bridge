/**
 * Shared type definitions for the Obsidian ↔ Filen bridge.
 */

export interface FilenSession {
	/** Derived master encryption keys (populated after login). */
	masterKeys: string[];
	/** API key for subsequent requests. */
	apiKey: string;
	/** User's public key for sharing. */
	publicKey: string;
	/** User's private key (encrypted). */
	privateKey: string;
	/** Authentication version (typically 2). */
	authVersion: number;
	/** Numeric Filen user ID. */
	userId: number;
	/** The user's root/base folder UUID. Required by the SDK for isLoggedIn(). */
	baseFolderUUID: string;
}