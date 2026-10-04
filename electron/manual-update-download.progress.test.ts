// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { downloadManualInstaller } from './manual-update-download.js';
import type { ManualCandidate } from './manual-update-manifest.js';
import type { UpdateDownloadProgress } from './update-status.js';

const data = Buffer.from('A verified fixture, not an executable installer.');
const candidate: ManualCandidate = {
  envelope: 'test owner already verified its manifest',
  release: {
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'manual-download',
    channel: 'stable',
    version: '1.0.8',
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-10-01T00:00:00.000Z',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: [
      {
        name: 'KerfDesk-1.0.8-windows-x64-setup.exe',
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      },
    ],
  },
};
const folders: string[] = [];
async function folder() {
  const value = await mkdtemp(join(tmpdir(), 'kerfdesk-update-progress-'));
  folders.push(value);
  return value;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const owned of folders.splice(0)) {
    if (dirname(owned) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(owned, { recursive: true, force: true });
  }
});

it('publishes written bytes and a verification phase without treating progress as installer consent', async () => {
  const progress: UpdateDownloadProgress[] = [];
  const staged = await downloadManualInstaller(
    candidate,
    await folder(),
    async () => new Response(data),
    (value) => progress.push(value),
  );
  expect(progress).toEqual([
    { phase: 'starting', receivedBytes: 0, totalBytes: data.length },
    { phase: 'receiving', receivedBytes: data.length, totalBytes: data.length },
    { phase: 'verifying', receivedBytes: data.length, totalBytes: data.length },
  ]);
  expect(await readFile(staged.path)).toEqual(data);
  expect(staged).not.toHaveProperty('installOnQuit');
});

it('rejects a silent body after bounded inactivity even without Content-Length and removes partial bytes', async () => {
  vi.useFakeTimers();
  const owned = await folder();
  let waiting!: () => void;
  const readerWaiting = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stream = controller;
        controller.enqueue(data.subarray(0, 5));
      },
      pull() {
        waiting();
      },
      cancel: () => new Promise<void>(() => undefined),
    },
    { highWaterMark: 0 },
  );
  const progress: UpdateDownloadProgress[] = [];
  let outcome: string | undefined;
  const download = downloadManualInstaller(
    candidate,
    owned,
    async () => new Response(body),
    (value) => progress.push(value),
  ).then(
    () => {
      outcome = 'ready';
    },
    () => {
      outcome = 'failed';
    },
  );
  await readerWaiting;
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    await download;
    expect(outcome).toBe('failed');
    expect(progress.at(-1)).toEqual({
      phase: 'receiving',
      receivedBytes: 5,
      totalBytes: data.length,
    });
    expect(await readdir(join(owned, 'manual-updates'))).toEqual([]);
  } finally {
    if (outcome === undefined) stream.error(new Error('Test cleanup'));
    await download;
  }
});
