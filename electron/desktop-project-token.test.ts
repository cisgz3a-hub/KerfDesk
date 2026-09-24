// @vitest-environment node
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopProjectTokens,
  DESKTOP_PROJECT_TOKEN_PATTERN,
  loadDesktopProjectKey,
  type DesktopProjectKeyStore,
} from './desktop-project-token.js';

const KEY = new Uint8Array(32).fill(7);

function memoryStore(initial: Record<string, string> = {}): DesktopProjectKeyStore & {
  readonly files: Record<string, string>;
} {
  const files = { ...initial };
  return {
    files,
    read: async (file) => {
      const contents = files[file];
      if (contents === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return contents;
    },
    write: async (file, contents) => {
      files[file] = contents;
    },
  };
}

describe('desktop project tokens', () => {
  it('verifies a token only for the exact path it was minted for', () => {
    const tokens = createDesktopProjectTokens(KEY);
    const token = tokens.mint('C:\\Jobs\\sign.lf2');

    expect(token).toMatch(DESKTOP_PROJECT_TOKEN_PATTERN);
    expect(tokens.verify('C:\\Jobs\\sign.lf2', token)).toBe(true);
    expect(tokens.verify('C:\\Jobs\\sign.lf2 ', token)).toBe(false);
    expect(tokens.verify('C:\\Windows\\win.ini', token)).toBe(false);
  });

  it('refuses tampered and malformed tokens', () => {
    const tokens = createDesktopProjectTokens(KEY);
    const token = tokens.mint('/jobs/sign.lf2');
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    expect(tokens.verify('/jobs/sign.lf2', tampered)).toBe(false);
    expect(tokens.verify('/jobs/sign.lf2', '')).toBe(false);
    expect(tokens.verify('/jobs/sign.lf2', `${token}=`)).toBe(false);
  });

  it('makes tokens under one key useless under another', () => {
    const token = createDesktopProjectTokens(KEY).mint('/jobs/sign.lf2');

    expect(createDesktopProjectTokens(new Uint8Array(32)).verify('/jobs/sign.lf2', token)).toBe(
      false,
    );
  });
});

describe('loadDesktopProjectKey', () => {
  it('creates the key once and reads the same key on the next launch', async () => {
    const store = memoryStore();
    const generate = vi.fn(() => KEY);

    const first = await loadDesktopProjectKey('/user-data', store, generate);
    const second = await loadDesktopProjectKey('/user-data', store, generate);

    expect(generate).toHaveBeenCalledOnce();
    expect(Buffer.from(second)).toEqual(Buffer.from(first));
    expect(Object.keys(store.files)).toEqual([
      path.join('/user-data', 'desktop-project-files.key'),
    ]);
  });

  it('replaces a damaged key file', async () => {
    const file = path.join('/user-data', 'desktop-project-files.key');
    const store = memoryStore({ [file]: 'not-a-key' });

    const key = await loadDesktopProjectKey('/user-data', store, () => KEY);

    expect(Buffer.from(key)).toEqual(Buffer.from(KEY));
    expect(store.files[file]).toBe(Buffer.from(KEY).toString('base64'));
  });

  it('still returns a working key for this session when it cannot be stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store: DesktopProjectKeyStore = {
      read: async () => {
        throw new Error('ENOENT');
      },
      write: async () => {
        throw new Error('read-only profile');
      },
    };

    const key = await loadDesktopProjectKey('/user-data', store, () => KEY);

    expect(Buffer.from(key)).toEqual(Buffer.from(KEY));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
