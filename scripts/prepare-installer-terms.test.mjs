import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeInstallerTerms, prepareInstallerTerms } from './prepare-installer-terms.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

test('NSIS copy preserves every UTF-8 byte after one encoding marker', () => {
  const source = Buffer.from('Safety — read carefully.\r\nLiability — café 中文 😀.\n');
  const encoded = encodeInstallerTerms(source);
  assert.deepEqual(encoded.subarray(0, 3), BOM);
  assert.deepEqual(encoded.subarray(3), source);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(encoded), source.toString('utf8'));
  assert.deepEqual(encodeInstallerTerms(encoded), encoded);
  assert.equal(encodeInstallerTerms(Buffer.alloc(262_144, 65)).length, 262_144 + 3);
  for (const bad of [
    Buffer.from([0xff]),
    Buffer.from('text\0'),
    Buffer.from(' \n'),
    Buffer.alloc(262_145, 65),
  ])
    assert.throws(() => encodeInstallerTerms(bad));
});

test('desktop preparation writes only the generated copy and refreshes it when source changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-installer-terms-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public'));
  const path = join(root, 'public/eula.txt');
  for (const text of ['Terms — first\r\n', '\ufeffTerms — second\n']) {
    const original = Buffer.from(text);
    await writeFile(path, original);
    const target = await prepareInstallerTerms(root);
    assert.deepEqual(await readFile(path), original);
    assert.deepEqual(await readFile(target), encodeInstallerTerms(original));
    assert.equal(target, join(root, 'build/installer-terms.txt'));
  }
});

test('all noncommercial NSIS profiles consume the generated copy before packaging', async () => {
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const { getConfig } = await import(
    pathToFileURL(requireBuilder.resolve('app-builder-lib/out/util/config/config.js')).href
  );
  for (const name of [
    'electron-builder.yml',
    'electron-builder.preview.yml',
    'electron-builder.sandbox.yml',
  ]) {
    const config = await getConfig(ROOT, join(ROOT, name), null);
    assert.equal(config.nsis.license, 'build/installer-terms.txt');
    assert.notEqual(config.nsis.unicode, false);
  }
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts['build:electron-main'],
    /^node scripts\/prepare-installer-terms\.mjs && /u,
  );
});
