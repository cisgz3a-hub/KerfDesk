import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPackage } from '@electron/asar';
import { finished } from 'node:stream/promises';
import verifyDesktopRenderer, { requireDesktopRendererHtml } from './verify-desktop-renderer.mjs';

const marker = (mode) => `<meta name="kerfdesk-build-capabilities" content="${mode}">`;

test('only one explicit desktop build marker passes the packaging boundary', () => {
  requireDesktopRendererHtml(`<html><head>${marker('desktop')}</head></html>`);
  requireDesktopRendererHtml("<meta content='desktop' name='kerfdesk-build-capabilities' />");
  for (const html of [
    '',
    marker('browser-free'),
    marker('test'),
    marker('desktop').repeat(2),
    marker('desktop') + marker('browser-free'),
  ])
    assert.throws(() => requireDesktopRendererHtml(html), /desktop renderer/u);
});

test('the builder hook reads the actual ASAR from the platform resources directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-renderer-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const resources = join(root, 'Application.app', 'Contents', 'Resources');
  await mkdir(join(source, 'dist/web'), { recursive: true });
  await mkdir(join(source, 'dist-electron'), { recursive: true });
  await mkdir(resources, { recursive: true });
  await writeFile(join(source, 'dist/web/index.html'), marker('desktop'));
  await writeFile(join(source, 'dist-electron/main.js'), '');
  await finished(await createPackage(source, join(resources, 'app.asar')));
  verifyDesktopRenderer({
    appOutDir: root,
    packager: {
      getResourcesDir: (directory) => {
        assert.equal(directory, root);
        return resources;
      },
    },
  });
});

test('the real afterPack archive boundary rejects missing nested packages and conditional entries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kerfdesk-runtime-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  let resources = join(root, 'missing-package');
  await mkdir(join(source, 'dist/web'), { recursive: true });
  await mkdir(join(source, 'dist-electron/remote'), { recursive: true });
  await mkdir(resources);
  await writeFile(join(source, 'dist/web/index.html'), marker('desktop'));
  await writeFile(join(source, 'dist-electron/main.js'), "import './remote/relay.js';");
  await writeFile(
    join(source, 'dist-electron/remote/relay.js'),
    "import WebSocket from 'ws'; export default WebSocket;",
  );
  const context = { appOutDir: root, packager: { getResourcesDir: () => resources } };
  await finished(await createPackage(source, join(resources, 'app.asar')));
  assert.throws(() => verifyDesktopRenderer(context), /missing runtime package ws/u);
  await mkdir(join(source, 'node_modules/ws'), { recursive: true });
  await writeFile(
    join(source, 'node_modules/ws/package.json'),
    JSON.stringify({ exports: { '.': { import: './wrapper.mjs', require: './index.js' } } }),
  );
  await writeFile(join(source, 'node_modules/ws/index.js'), 'module.exports = {};');
  resources = join(root, 'missing-import-entry');
  await mkdir(resources);
  await finished(await createPackage(source, join(resources, 'app.asar')));
  assert.throws(
    () => verifyDesktopRenderer(context),
    /missing runtime entry node_modules\/ws\/wrapper.mjs/u,
  );
  await writeFile(join(source, 'node_modules/ws/wrapper.mjs'), 'export default {};');
  resources = join(root, 'complete');
  await mkdir(resources);
  await finished(await createPackage(source, join(resources, 'app.asar')));
  verifyDesktopRenderer(context);
});
