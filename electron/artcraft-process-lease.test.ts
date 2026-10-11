// @vitest-environment node
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEditorProcessIdentity } from './artcraft-process-identity';
import { checkEditorLease, saveEditorLease } from './artcraft-process-lease';
vi.mock('./artcraft-process-identity', async (original) => ({
  ...(await original<typeof import('./artcraft-process-identity')>()),
  readEditorProcessIdentity: vi.fn(),
}));
const directories: string[] = [];
const identity = { pid: 42, startTime: '1234567', executable: path.resolve('editor.exe') };
async function fixture(lease: unknown = identity) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-lease-test-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'editor-process.json'), JSON.stringify(lease));
  return directory;
}
beforeEach(() => {
  vi.mocked(readEditorProcessIdentity).mockReset();
});
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('kerfdesk-lease-test-')
    )
      throw new Error('Unexpected cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});
describe('editor process instance leases', () => {
  it('refuses the same still-running editor instance', async () => {
    vi.mocked(readEditorProcessIdentity).mockResolvedValue(identity);
    await expect(checkEditorLease(await fixture())).rejects.toThrow('still running');
  });
  it.each([
    null,
    { ...identity, startTime: '9999999' },
    { ...identity, executable: path.resolve('other.exe') },
  ])('allows a dead or reused PID: %j', async (current) => {
    vi.mocked(readEditorProcessIdentity).mockResolvedValue(current);
    await expect(checkEditorLease(await fixture())).resolves.toBeUndefined();
  });
  it('does not treat access denied as a dead editor', async () => {
    vi.mocked(readEditorProcessIdentity).mockRejectedValue(new Error('Access denied'));
    await expect(checkEditorLease(await fixture())).rejects.toThrow('Cannot verify');
  });
  it('explains an older PID-only record and allows it only once no process remains', async () => {
    const directory = await fixture({ pid: 42 });
    vi.mocked(readEditorProcessIdentity).mockResolvedValue(identity);
    await expect(checkEditorLease(directory)).rejects.toThrow('older editor record');
    vi.mocked(readEditorProcessIdentity).mockResolvedValue(null);
    await expect(checkEditorLease(directory)).resolves.toBeUndefined();
  });
  it('records the verified start identity and rejects a different launched executable', async () => {
    const directory = await fixture();
    vi.mocked(readEditorProcessIdentity).mockResolvedValue(identity);
    await expect(saveEditorLease(directory, 42, path.resolve('wrong.exe'))).rejects.toThrow(
      'does not match',
    );
    await saveEditorLease(directory, 42, identity.executable);
    expect(JSON.parse(await readFile(path.join(directory, 'editor-process.json'), 'utf8'))).toEqual(
      identity,
    );
  });
});
