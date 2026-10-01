import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPDATE_NOTES_LIMIT,
  updateNotesUrl,
  verifyUpdateNotes,
} from '../public/desktop-update-notes.mjs';
import { manualDownloadKey, verifyManualDownload } from '../public/desktop-manual-download.mjs';
import { signUpdateNotes, updateNotesStorageKey } from './manual-commercial-notes.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import * as stable from './commercial-release-test-support.mjs';
import * as preview from './preview-release-test-support.mjs';

const release = manualDownloadPayload(
  stable.fixture().identity,
  Buffer.from('installer'),
  stable.keySet,
);
const reviewed = {
  schemaVersion: 1,
  sinceSourceSha: null,
  highlights: ['Power numbers are easier to edit.', 'Read improvements before updating.'],
};
const sign = (notes = reviewed, candidate = release) =>
  signUpdateNotes(candidate, notes, stable.privateKeyPem, stable.keyId, stable.keySet);

test('signed notes round-trip plain customer highlights bound to the trusted release', async () => {
  const bytes = await sign();
  const notes = await verifyUpdateNotes(bytes.toString('utf8'), stable.keySet, release);
  assert.deepEqual(notes.highlights, reviewed.highlights);
  assert.equal(notes.version, release.version);
  assert.equal(notes.sourceSha, release.sourceSha);
  assert.equal(notes.publishedAt, release.publishedAt);
  assert.equal(
    updateNotesUrl('1.2.3'),
    'https://dl.kerfdesk.com/desktop/commercial-manual/releases/1.2.3/release-notes.json',
  );
  assert.equal(
    updateNotesStorageKey('1.2.3'),
    'desktop/commercial-manual/releases/1.2.3/release-notes.json',
  );
  // The sidecar is deliberately absent from the existing executable/download allowlist.
  assert.throws(() => manualDownloadKey('1.2.3', 'release-notes.json'));
  for (const version of [
    '../1.2.3',
    '1.2.3/evil',
    '1.2.3-preview.1',
    '01.2.3',
    'https://bad.invalid',
  ])
    assert.throws(() => updateNotesUrl(version));
});

test('old manual manifest exact schema remains unchanged and cannot be mistaken for notes', async () => {
  const envelope = await signManualDownload(
    release,
    stable.privateKeyPem,
    stable.keyId,
    stable.keySet,
  );
  assert.deepEqual(await verifyManualDownload(JSON.stringify(envelope), stable.keySet), release);
  await assert.rejects(verifyUpdateNotes(JSON.stringify(envelope), stable.keySet, release));
  await assert.rejects(verifyManualDownload((await sign()).toString('utf8'), stable.keySet));
});

test('genuine signatures cannot authorize notes for a different source, version or time', async () => {
  const text = (await sign()).toString('utf8');
  for (const change of [
    { sourceSha: 'b'.repeat(40) },
    { version: '1.2.4' },
    { publishedAt: '2026-01-02T00:00:00.000Z' },
  ])
    await assert.rejects(
      verifyUpdateNotes(text, stable.keySet, { ...release, ...change }),
      /release mismatch/u,
    );
  await assert.rejects(
    verifyUpdateNotes(text, stable.keySet, release, Date.parse('2025-12-31T23:54:59.999Z')),
    /time/u,
  );
});

test('tampered, wrong-purpose and oversized signed notes fail closed', async () => {
  const envelope = JSON.parse((await sign()).toString('utf8'));
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'));
  const tampered = {
    ...envelope,
    payload: Buffer.from(JSON.stringify({ ...payload, highlights: ['Tampered'] })).toString(
      'base64',
    ),
  };
  await assert.rejects(
    verifyUpdateNotes(JSON.stringify(tampered), stable.keySet, release),
    /signature/u,
  );
  await assert.rejects(verifyUpdateNotes(JSON.stringify(envelope), preview.keySet, release));
  await assert.rejects(
    verifyUpdateNotes(
      `${' '.repeat(UPDATE_NOTES_LIMIT)}${JSON.stringify(envelope)}`,
      stable.keySet,
      release,
    ),
    /size/u,
  );
  for (const change of [
    { kind: 'manual-download' },
    { channel: 'preview' },
    { url: 'https://bad.invalid' },
    { sourceRef: 'refs/heads/main' },
  ])
    await assert.rejects(
      verifyUpdateNotes(
        JSON.stringify(stable.signed({ ...payload, ...change })),
        stable.keySet,
        release,
      ),
    );
});

test('notes bounds count characters and refuse markup, controls, duplicate or empty lines', async () => {
  assert.equal(
    (
      await verifyUpdateNotes(
        (await sign({ ...reviewed, highlights: ['😀'.repeat(240)] })).toString(),
        stable.keySet,
        release,
      )
    ).highlights[0].length,
    480,
  );
  for (const highlights of [
    [],
    Array.from({ length: 7 }, (_, i) => `Change ${i}`),
    [''],
    [' padded'],
    ['padded '],
    ['same', 'same'],
    ['x'.repeat(241)],
    ['😀'.repeat(241)],
    ['<b>fix</b>'],
    ['line\nbreak'],
    ['tab\tvalue'],
    ['null\0value'],
    ['hidden\u202evalue'],
    [12],
  ])
    await assert.rejects(sign({ ...reviewed, highlights }));
});
