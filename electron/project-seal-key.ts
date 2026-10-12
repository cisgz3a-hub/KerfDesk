import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { record } from './licensing-verification.js';

// This computer's project seal key (ADR-592): 32 random bytes kept beside the
// licence record under the operating system's protection. The renderer seals
// the project text it saves with it, so desktop Free can tell this computer's
// own Pro work from a shared or hand-edited project.

const FILE_NAME = 'project-seal.v1';
const KEY = /^[A-Za-z0-9_-]{43}$/;

type SecureStorage = {
  readonly isAsyncEncryptionAvailable: () => Promise<boolean>;
  readonly encryptStringAsync: (value: string) => Promise<Buffer>;
  readonly decryptStringAsync: (
    value: Buffer,
  ) => Promise<{ result: string; shouldReEncrypt: boolean }>;
};

/** Reads the key once per process, creating it on first use; null when unavailable. */
export function createProjectSealKey(options: {
  readonly userDataPath: string;
  readonly secureStorage: SecureStorage;
}): () => Promise<string | null> {
  let known: Promise<string | null> | null = null;
  return () => {
    known ??= loadKey(options).catch(() => {
      known = null;
      return null;
    });
    return known;
  };
}

async function loadKey(options: {
  readonly userDataPath: string;
  readonly secureStorage: SecureStorage;
}): Promise<string | null> {
  const secure = options.secureStorage;
  if (!(await secure.isAsyncEncryptionAvailable())) return null;
  const file = join(options.userDataPath, FILE_NAME);
  const saved = await readKey(file, secure);
  if (saved !== 'missing' && saved !== 'unreadable') return saved;
  // A key the operating system can no longer open (a reset Windows account)
  // is set aside, never deleted; projects sealed with it need Pro to reopen.
  if (saved === 'unreadable')
    await rename(file, `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const key = randomBytes(32).toString('base64url');
  await mkdir(options.userDataPath, { recursive: true });
  try {
    await writeFile(file, await secure.encryptStringAsync(key), { flag: 'wx', mode: 0o600 });
    return key;
  } catch (error) {
    // Another KerfDesk window created it first: use that one.
    if (record(error) && error.code === 'EEXIST') {
      const winner = await readKey(file, secure);
      return winner === 'missing' || winner === 'unreadable' ? null : winner;
    }
    throw error;
  }
}

async function readKey(
  file: string,
  secure: SecureStorage,
): Promise<string | 'missing' | 'unreadable'> {
  let encrypted: Buffer;
  try {
    encrypted = await readFile(file);
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return 'missing';
    throw error;
  }
  try {
    const { result } = await secure.decryptStringAsync(encrypted);
    return KEY.test(result) ? result : 'unreadable';
  } catch {
    return 'unreadable';
  }
}
