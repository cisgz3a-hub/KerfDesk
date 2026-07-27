import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import asar from '@electron/asar';

import { verifyPackagedPreviewAsar } from './verify-packaged-preview-metadata.mjs';

const PREVIEW_VERSION = '0.2.0-preview.14';
const WRONG_RENDERER_VERSION = '0.1.822';

async function createPreviewArchive(rendererVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-preview-version-'));
  const source = path.join(root, 'source');
  const assets = path.join(source, 'dist', 'web', 'assets');
  const archive = path.join(root, 'app.asar');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({
      version: PREVIEW_VERSION,
      kerfdeskDesktopReleaseChannel: 'preview',
      kerfdeskUpdateChannelTrusted: false,
    }),
  );
  fs.writeFileSync(
    path.join(assets, 'index-fixture.js'),
    `const buildVersion = ${JSON.stringify(rendererVersion)};\n`,
  );
  await asar.createPackage(source, archive);
  return { archive, root };
}

test('accepts an archive whose renderer and package use the exact Preview version', async () => {
  const fixture = await createPreviewArchive(PREVIEW_VERSION);
  try {
    assert.doesNotThrow(() => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects an archive whose visible renderer version differs from package metadata', async () => {
  const fixture = await createPreviewArchive(WRONG_RENDERER_VERSION);
  try {
    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /renderer version mismatch/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
