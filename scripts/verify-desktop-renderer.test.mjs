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
  await mkdir(resources, { recursive: true });
  await writeFile(join(source, 'dist/web/index.html'), marker('desktop'));
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
