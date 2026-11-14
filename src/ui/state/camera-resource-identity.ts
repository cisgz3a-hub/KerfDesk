import { cameraAddressWithoutUserinfo } from '../../core/camera/camera-address-login';

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
    // Keyed as it always was, so identities saved before still match.
    const payload = JSON.stringify([cameraAddressWithoutUserinfo(raw), url.search]);
    const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return `hmac-sha256:${hex(new Uint8Array(signature))}`;
  } catch {
    // Missing secure crypto/key: capture stays usable, but identity cannot match.
    return undefined;
  }
}

// ADR-692 Amendment 3 (the maintainer's choices on camera audit v2 K5-P3-3
// and K5r-P3-4): a calibration of a network camera follows the same camera at
// the same address to another computer. The keyed fingerprint above never
// leaves this computer, so beside it a calibration keeps a portable one: a
// slow, fixed-salt PBKDF2 hash of the address without its login, so the path
// and query count (two channels of one recorder differ only there) without
// being revealed, and a changed password does not change it.
const PORTABLE_SALT = 'kerfdesk.camera.identity.v1';
const PORTABLE_ITERATIONS = 200_000;
const LOGIN_FIELD = /^(?:user|usr|username|login|pass|password|pwd|passwd|passwort)$/i;
const LOGIN_IN_PATH = /(^|[_&;])(?:user|usr|username|login|pass|password|pwd|passwd)=[^_&;/]*/gi;

/** `raw` with every login removed: userinfo, login-shaped query fields and path fields. */
export function cameraAddressWithoutLogin(raw: string): string {
  const url = new URL(raw.trim());
  const kept = [...url.searchParams].filter(([name]) => !LOGIN_FIELD.test(name));
  const search = kept.length === 0 ? '' : `?${new URLSearchParams(kept).toString()}`;
  const path = url.pathname
    .split('/')
    .map((segment) => segment.replace(LOGIN_IN_PATH, '$1').replace(/^[_&;]+|[_&;]+$/g, ''))
    .join('/');
  return `${url.protocol}//${url.host}${path}${search}`;
}

/** The camera's identity that travels with its calibration; undefined without secure crypto. */
export async function cameraPortableFingerprint(raw: string): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return undefined;
    const encoder = new TextEncoder();
    const material = await subtle.importKey(
      'raw',
      encoder.encode(cameraAddressWithoutLogin(raw.trim())),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: encoder.encode(PORTABLE_SALT),
        iterations: PORTABLE_ITERATIONS,
      },
      material,
      256,
    );
    return `pbkdf2-sha256:${hex(new Uint8Array(bits))}`;
  } catch {
    return undefined;
  }
}

/** Both identities of a network camera, as a camera source carries them. */
export async function cameraIdentityFingerprints(
  raw: string,
): Promise<{ readonly queryFingerprint?: string; readonly portableFingerprint?: string }> {
  const [queryFingerprint, portableFingerprint] = await Promise.all([
    cameraQueryFingerprint(raw),
    cameraPortableFingerprint(raw),
  ]);
  return {
    ...(queryFingerprint === undefined ? {} : { queryFingerprint }),
    ...(portableFingerprint === undefined ? {} : { portableFingerprint }),
  };
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
