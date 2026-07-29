import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import asar from '@electron/asar';

import { verifyPackagedPreviewAsar } from './verify-packaged-preview-metadata.mjs';

const PREVIEW_VERSION = '0.2.0-preview.14';
const NEAR_COLLISION_RENDERER_VERSION = '0.2.0-preview.140';
const WRONG_RENDERER_VERSION = '0.1.822';
const PACKAGE_AUTHOR_NAME = 'Johann Stolk';
const ABOUT_MARKER = 'Free and open-source under the MIT License';
const BUILD_BADGE_MARKER = 'Build version';

async function createPreviewArchive(options = {}) {
  const aboutVersion = options.aboutVersion ?? PREVIEW_VERSION;
  const buildBadgeVersion = options.buildBadgeVersion ?? PREVIEW_VERSION;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-preview-version-'));
  const source = path.join(root, 'source');
  const assets = path.join(source, 'dist', 'web', 'assets');
  const archive = path.join(root, 'app.asar');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({
      version: PREVIEW_VERSION,
      author: { name: options.authorName ?? PACKAGE_AUTHOR_NAME },
      kerfdeskDesktopReleaseChannel: 'preview',
      kerfdeskUpdateChannelTrusted: false,
    }),
  );
  fs.writeFileSync(
    path.join(assets, 'index-fixture.js'),
    `const about = ${JSON.stringify(`${ABOUT_MARKER} ${aboutVersion}`)};\n`,
  );
  fs.writeFileSync(
    path.join(assets, 'ui-workbench-fixture.js'),
    `const buildBadge = ${JSON.stringify(`${BUILD_BADGE_MARKER} ${buildBadgeVersion}`)};\n`,
  );
  await asar.createPackage(source, archive);
  return { archive, root };
}

test('accepts an archive whose renderer and package use the exact Preview version', async () => {
  const fixture = await createPreviewArchive();
  try {
    assert.doesNotThrow(() => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects an archive whose package does not carry the truthful author identity', async () => {
  const fixture = await createPreviewArchive({ authorName: 'GitHub, Inc.' });
  try {
    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /packaged author mismatch/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects an archive whose About version differs from package metadata', async () => {
  const fixture = await createPreviewArchive({ aboutVersion: WRONG_RENDERER_VERSION });
  try {
    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /About renderer version mismatch/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects an archive whose Build badge version differs from package metadata', async () => {
  const fixture = await createPreviewArchive({ buildBadgeVersion: WRONG_RENDERER_VERSION });
  try {
    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /Build badge renderer version mismatch/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a longer renderer version that only contains the expected version as a prefix', async () => {
  const fixture = await createPreviewArchive({
    buildBadgeVersion: NEAR_COLLISION_RENDERER_VERSION,
  });
  try {
    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /Build badge renderer version mismatch/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
