import { cameraSourceIdWithoutCredentials } from '../../core/camera/camera-capture-binding';

const KEY_STORAGE = 'laserforge.camera.resourceIdentityKey.v1';
const KEY_BYTES = 32;
let sessionKey: string | undefined;

/** App-local resource identity; neither query credentials nor the key enter a project. */
export async function cameraQueryFingerprint(raw: string): Promise<string | undefined> {
  try {
    const url = new URL(raw.trim());
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return undefined;
    const secret = loadOrCreateKey();
    const key = await subtle.importKey(
      'raw',
      Uint8Array.from(secret.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    // Empty query is known resource data, distinct from an unknown legacy binding.
    const payload = JSON.stringify([cameraSourceIdWithoutCredentials(raw), url.search]);
    const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return `hmac-sha256:${hex(new Uint8Array(signature))}`;
  } catch {
    // Missing secure crypto/key: capture stays usable, but identity cannot match.
    return undefined;
  }
}

function loadOrCreateKey(): string {
  let stored: string | null;
  try {
    stored = localStorage.getItem(KEY_STORAGE);
  } catch {
    return (sessionKey ??= randomKey());
  }
  if (stored !== null && /^[0-9a-f]{64}$/.test(stored)) return (sessionKey = stored);
  const created = randomKey();
  try {
    localStorage.setItem(KEY_STORAGE, created);
  } catch {
    // A private/quota-limited session can still calibrate; only reload loses its key.
    return (sessionKey ??= created);
  }
  return (sessionKey = created);
}

function randomKey(): string {
  return hex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
