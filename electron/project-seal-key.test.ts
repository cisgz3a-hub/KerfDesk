// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createProjectSealKey } from './project-seal-key';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

// Deliberately fake operating-system protection; native safeStorage is qualified separately.
const secureStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`enc:${value}`),
  decryptStringAsync: async (value: Buffer) => {
    const text = value.toString();
    if (!text.startsWith('enc:')) throw new Error('Cannot decrypt');
    return { result: text.slice(4), shouldReEncrypt: false };
  },
};

async function profile(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'kerfdesk-seal-key-'));
  directories.push(path);
  return path;
}

it('creates one protected random key per computer and keeps it across restarts (ADR-592)', async () => {
  const userDataPath = await profile();
  const first = await createProjectSealKey({ userDataPath, secureStorage })();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await readFile(join(userDataPath, 'project-seal.v1'))).toString()).toBe(`enc:${first}`);
  expect(await createProjectSealKey({ userDataPath, secureStorage })()).toBe(first);
  const other = await createProjectSealKey({ userDataPath: await profile(), secureStorage })();
  expect(other).not.toBe(first);
});

it('sets an unreadable key aside instead of deleting it, and offers none without protection', async () => {
  const userDataPath = await profile();
  await writeFile(join(userDataPath, 'project-seal.v1'), 'not protected');
  const replaced = await createProjectSealKey({ userDataPath, secureStorage })();
  expect(replaced).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await readdir(userDataPath)).some((name) => name.includes('.unreadable-'))).toBe(true);
  const unprotected = createProjectSealKey({
    userDataPath: await profile(),
    secureStorage: { ...secureStorage, isAsyncEncryptionAvailable: async () => false },
  });
  expect(await unprotected()).toBeNull();
});
