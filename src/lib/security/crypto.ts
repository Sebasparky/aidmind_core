/**
 * Case Notes Vault — AES-256-GCM encryption with PBKDF2 key derivation
 *
 * SECURITY DESIGN:
 * - Key derived from user's password via PBKDF2 (100k iterations, SHA-256)
 * - Each seal operation generates a unique random salt + IV
 * - AES-256-GCM provides authenticated encryption (tamper detection)
 * - The server never sees the plaintext or the derived key
 * - Decryption requires the original password — no backdoor
 *
 * LIMITATIONS (honest):
 * - Security depends on password strength (PBKDF2 mitigates weak passwords)
 * - Browser memory is not truly secure (debugger, extensions can inspect)
 * - This is defense-in-depth, not a hardware security module
 * - If the user forgets their password, sealed data is unrecoverable
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard
const KEY_LENGTH = 256; // AES-256

export interface SealedPayload {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded salt used for PBKDF2 */
  salt: string;
  /** Base64-encoded IV used for AES-GCM */
  iv: string;
  /** Metadata — never contains sensitive content */
  sealed_at: string;
  /** Version for forward compatibility */
  version: 1;
}

// ── Helpers ──────────────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false, // not extractable — defense in depth
    ["encrypt", "decrypt"],
  );
}

// ── Public API ───────────────────────────────────────────

/**
 * Encrypt a plaintext payload using a password-derived AES-256-GCM key.
 * Returns a SealedPayload with base64-encoded components.
 */
export async function sealPayload(
  plaintext: string,
  password: string,
): Promise<SealedPayload> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(plaintext) as BufferSource,
  );

  return {
    ciphertext: toBase64(ciphertext),
    salt: toBase64(salt.buffer as ArrayBuffer),
    iv: toBase64(iv.buffer as ArrayBuffer),
    sealed_at: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Decrypt a SealedPayload using the original password.
 * Throws if password is wrong or data is tampered with.
 */
export async function unsealPayload(
  sealed: SealedPayload,
  password: string,
): Promise<string> {
  if (sealed.version !== 1) {
    throw new Error("Unsupported vault version");
  }

  const salt = fromBase64(sealed.salt);
  const iv = fromBase64(sealed.iv);
  const ciphertext = fromBase64(sealed.ciphertext);

  const key = await deriveKey(password, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // AES-GCM throws on wrong key or tampered data
    throw new Error("DECRYPTION_FAILED");
  }
}

/**
 * Overwrite a string's memory with zeros (best-effort in JS).
 * JavaScript strings are immutable, so this creates a zeroed replacement
 * and relies on GC to collect the original. Not a guarantee, but
 * better than leaving plaintext indefinitely.
 */
export function scrubString(value: string): string {
  // Return empty string — the original will be GC'd when no references remain
  void value;
  return "";
}
