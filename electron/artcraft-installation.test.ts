// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTCRAFT_EXECUTABLE_SHA256, readArtcraftInstallation } from './artcraft-installation';
const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith('kerfdesk-install-test-')
    )
      throw new Error('Unexpected cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
describe.skipIf(process.platform !== 'win32')('pinned editor installation identity', () => {
  it('does not trust an altered executable with a recomputed manifest digest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-install-test-'));
    temporary.push(root);
    const bytes = Buffer.from('replacement executable');
    await writeFile(path.join(root, 'photo.exe'), bytes);
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        schema: 1,
        editors: [
          {
            id: 'photo',
            version: '0.7.0',
            executable: 'photo.exe',
            executableSha256: createHash('sha256').update(bytes).digest('hex'),
          },
        ],
      }),
    );
    expect(await readArtcraftInstallation(root, 'photo', true)).toBeNull();
  });
  it('hashes the real file before launch even if the manifest claims the pinned digest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-install-test-'));
    temporary.push(root);
    await writeFile(path.join(root, 'photo.exe'), 'replacement executable');
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        schema: 1,
        editors: [
          {
            id: 'photo',
            version: '0.7.0',
            executable: 'photo.exe',
            executableSha256: ARTCRAFT_EXECUTABLE_SHA256.photo,
          },
        ],
      }),
    );
    expect(await readArtcraftInstallation(root, 'photo')).not.toBeNull();
    expect(await readArtcraftInstallation(root, 'photo', true)).toBeNull();
  });
});
