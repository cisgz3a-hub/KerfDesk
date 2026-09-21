import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import asar from '@electron/asar';

import {
  assertPackagedArchiveComplete,
  verifyPackagedPreviewAsar,
} from './verify-packaged-preview-metadata.mjs';

const ARCHIVE_FLUSH_TIMEOUT_MS = 10_000;
const ARCHIVE_FLUSH_POLL_MS = 25;
const ASAR_SIZE_PICKLE_BYTES = 8;

/**
 * Do not hand a fixture over until its archive is entirely on disk.
 *
 * `@electron/asar`'s `createPackage` does not wait for its own output to
 * flush. Each packed file resolves on the SOURCE stream's `end` while the
 * destination is piped with `{ end: false }`, and the closing `out.end()` is
 * returned rather than awaited, so the promise can settle with bytes still
 * buffered. The header is flushed explicitly, which is the worst case: the
 * archive looks valid, its header parses, and the bodies read back as zeros
 * because asar's file read ignores the length `fs.readSync` returns.
 *
 * That is how this suite failed once on CI and never once locally, with
 * `Unexpected token '\x00', "\x00\x00…" is not valid JSON` from the
 * `package.json` parse. Waiting on the length the header itself describes
 * removes the race without weakening anything the tests assert: the verifier
 * still receives a complete archive and still has to judge it.
 */
async function settledArchive(archive) {
  const deadline = Date.now() + ARCHIVE_FLUSH_TIMEOUT_MS;
  for (;;) {
    asar.uncache(archive);
    try {
      assertPackagedArchiveComplete(archive);
      return archive;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, ARCHIVE_FLUSH_POLL_MS));
    }
  }
}

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
  await settledArchive(archive);
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

test('names a truncated archive instead of reporting invalid JSON', async () => {
  // The exact CI failure this check exists for: asar length-checks its header
  // read but zero-fills its body read, so an archive cut off after the header
  // used to surface as a JSON syntax error about NUL bytes.
  const fixture = await createPreviewArchive();
  try {
    const complete = fs.readFileSync(fixture.archive);
    const { headerSize } = asar.getRawHeader(fixture.archive);
    fs.writeFileSync(fixture.archive, complete.subarray(0, ASAR_SIZE_PICKLE_BYTES + headerSize));
    asar.uncacheAll();

    assert.throws(
      () => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION),
      /packaged archive is truncated: \d+ bytes on disk, \d+ required/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('accepts a complete archive as exactly the length its header describes', async () => {
  const fixture = await createPreviewArchive();
  try {
    const required = assertPackagedArchiveComplete(fixture.archive);

    // Exact, not a lower bound: asar pads nothing between bodies, so a
    // mismatch here would mean the length arithmetic had drifted from the
    // format and the truncation check could no longer be trusted.
    assert.equal(fs.statSync(fixture.archive).size, required);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('waits for a late flush instead of reading the archive short', async () => {
  // The fix itself, driven directly: an archive that is briefly shorter than
  // its header describes must be waited for, not read. Without the wait the
  // verifier parses zeros and fails, which is what CI saw once.
  const fixture = await createPreviewArchive();
  try {
    const complete = fs.readFileSync(fixture.archive);
    const { headerSize } = asar.getRawHeader(fixture.archive);
    fs.writeFileSync(fixture.archive, complete.subarray(0, ASAR_SIZE_PICKLE_BYTES + headerSize));
    asar.uncacheAll();
    // The rest of the bytes land after the wait has already begun.
    const lateFlush = setTimeout(() => fs.writeFileSync(fixture.archive, complete), 60);

    await settledArchive(fixture.archive);
    clearTimeout(lateFlush);

    assert.doesNotThrow(() => verifyPackagedPreviewAsar(fixture.archive, PREVIEW_VERSION));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
