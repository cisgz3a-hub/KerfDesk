// Tokens that let the renderer ask main for a project file again (ADR-378).
//
// Main mints a token only for a path the operating system handed over, as an
// HMAC of that exact path under a key the renderer never sees. The renderer
// keeps { path, token } in Recent Projects; any other path, or a changed one,
// fails verification, so a compromised page cannot turn the read route into a
// general file reader. The key lives in userData so Recent Projects entries
// still open after a restart; losing it only means choosing those files again.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const KEY_FILE = 'desktop-project-files.key';
const KEY_BYTES = 32;
const TOKEN_DOMAIN = 'kerfdesk-desktop-project-path-v1\0';

/** base64url of a SHA-256 HMAC. */
export const DESKTOP_PROJECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DesktopProjectTokens = {
  readonly mint: (file: string) => string;
  readonly verify: (file: string, token: string) => boolean;
};

export type DesktopProjectKeyStore = {
  readonly read: (file: string) => Promise<string>;
  readonly write: (file: string, contents: string) => Promise<void>;
};

const NODE_KEY_STORE: DesktopProjectKeyStore = {
  read: (file) => readFile(file, 'utf8'),
  write: (file, contents) => writeFile(file, contents, { encoding: 'utf8', mode: 0o600 }),
};

export function createDesktopProjectTokens(key: Uint8Array): DesktopProjectTokens {
  const mint = (file: string): string =>
    createHmac('sha256', key).update(TOKEN_DOMAIN).update(file, 'utf8').digest('base64url');
  return {
    mint,
    verify: (file, token) => {
      if (!DESKTOP_PROJECT_TOKEN_PATTERN.test(token)) return false;
      const expected = Buffer.from(mint(file), 'utf8');
      const actual = Buffer.from(token, 'utf8');
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}

/** The persisted key, created on first use. A key that cannot be stored still
 * works for this session. */
export async function loadDesktopProjectKey(
  userDataPath: string,
  store: DesktopProjectKeyStore = NODE_KEY_STORE,
  generate: () => Uint8Array = () => randomBytes(KEY_BYTES),
): Promise<Uint8Array> {
  const file = path.join(userDataPath, KEY_FILE);
  const stored = await readKey(store, file);
  if (stored !== null) return stored;
  const key = generate();
  try {
    await store.write(file, Buffer.from(key).toString('base64'));
  } catch (error) {
    console.warn('Recent project access will not survive a restart:', error);
  }
  return key;
}

async function readKey(store: DesktopProjectKeyStore, file: string): Promise<Uint8Array | null> {
  try {
    const key = Buffer.from((await store.read(file)).trim(), 'base64');
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}
