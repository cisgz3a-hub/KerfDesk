// @vitest-environment node
import { mkdtemp, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtcraftRuntime } from './artcraft-runtime';
import { initialiseEditor, inspectEditor, saveEditorRevision } from './artcraft-operations';
import { launchArtcraftProcess } from './artcraft-process';
import { checkEditorLease } from './artcraft-process-lease';

vi.mock('./artcraft-installation.js', () => ({
  ARTCRAFT_VERSIONS: { photo: '0.7.0', vector: '0.9.0' },
  readArtcraftInstallation: vi.fn(async () => ({ executable: 'trusted.exe' })),
}));
vi.mock('./artcraft-process.js', () => ({ launchArtcraftProcess: vi.fn() }));
vi.mock('./artcraft-process-lease.js', () => ({ checkEditorLease: vi.fn(async () => undefined) }));
vi.mock('./artcraft-operations.js', async (original) => ({
  ...(await original<typeof import('./artcraft-operations')>()),
  initialiseEditor: vi.fn(),
  inspectEditor: vi.fn(),
  saveEditorRevision: vi.fn(),
}));

let root: string;
let running = true;
beforeEach(async () => {
  vi.resetAllMocks();
  running = true;
  root = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-artcraft-runtime-'));
  vi.mocked(launchArtcraftProcess).mockResolvedValue({
    child: {} as ChildProcess,
    running: () => running,
    request: vi.fn(async () => null),
  });
  vi.mocked(initialiseEditor).mockImplementation(async (_process, session, directory) => {
    await writeFile(
      path.join(directory, 'working.pcraft'),
      session.nativeFile
        ? await readFile(path.join(directory, session.nativeFile))
        : 'layered original',
    );
  });
  vi.mocked(inspectEditor).mockResolvedValue({
    active: 0,
    revision: 1,
    documentPath: 'working.pcraft',
    widthMm: 100,
    heightMm: 50,
  });
  vi.mocked(saveEditorRevision).mockImplementation(
    async (_process, _editor, directory, relative) => {
      await mkdir(path.join(directory, relative), { recursive: true });
      const output = relative + '/artwork.png';
      await writeFile(path.join(directory, output), 'PNG fixture');
      return { native: 'working.pcraft', output };
    },
  );
});
describe('desktop session ownership and revision persistence', () => {
  it('preserves frozen revisions while reopening the latest native File Save', async () => {
    const runtime = createArtcraftRuntime(root, 'editors');
    const session = await runtime.open({ editor: 'photo' });
    const first = await runtime.snapshot(session.id);
    const directory = path.join(root, 'artcraft-studio', session.id);
    const frozen = path.join(directory, 'revisions', first.revision, 'source.pcraft');
    await writeFile(path.join(directory, 'working.pcraft'), 'later unsaved handoff');
    expect(await readFile(frozen, 'utf8')).toBe('layered original');
    const recovered = createArtcraftRuntime(root, 'editors');
    expect((await recovered.status()).sessions).toHaveLength(1);
    await recovered.resume(session.id);
    expect(await readFile(path.join(directory, 'working.pcraft'), 'utf8')).toBe(
      'later unsaved handoff',
    );
    const second = await recovered.snapshot(session.id);
    expect(second.filename).toBe(first.filename);
    expect(second.revision).not.toBe(first.revision);
    expect(second).toMatchObject({ widthMm: 100, heightMm: 50, nativeSaved: true });
  });
  it('never presents a running but failed initialisation as ready to apply', async () => {
    vi.mocked(initialiseEditor).mockRejectedValueOnce(new Error('open failed'));
    const runtime = createArtcraftRuntime(root, 'editors');
    await expect(runtime.open({ editor: 'photo' })).rejects.toThrow('open failed');
    const [session] = (await runtime.status()).sessions;
    expect(session?.running).toBe(false);
    await expect(runtime.snapshot(session!.id)).rejects.toThrow('Reopen');
    await expect(runtime.resume(session!.id)).rejects.toThrow('initialization failed');
    expect(saveEditorRevision).not.toHaveBeenCalled();
  });
  it('rejects artwork from another active document before saving anything', async () => {
    const runtime = createArtcraftRuntime(root, 'editors');
    const session = await runtime.open({ editor: 'photo' });
    vi.mocked(inspectEditor).mockResolvedValue({
      active: 1,
      revision: 1,
      documentPath: 'unrelated.pcraft',
    });
    await expect(runtime.snapshot(session.id)).rejects.toThrow('managed working document');
    expect(saveEditorRevision).not.toHaveBeenCalled();
  });
  it('does not advance the recoverable revision when artwork changes during export', async () => {
    const runtime = createArtcraftRuntime(root, 'editors');
    const session = await runtime.open({ editor: 'photo' });
    vi.mocked(inspectEditor)
      .mockResolvedValueOnce({ active: 0, revision: 1, documentPath: 'working.pcraft' })
      .mockResolvedValueOnce({ active: 0, revision: 2, documentPath: 'working.pcraft' });
    await expect(runtime.snapshot(session.id)).rejects.toThrow('changed during Apply');
    const stored = JSON.parse(
      await readFile(path.join(root, 'artcraft-studio', session.id, 'session.json'), 'utf8'),
    );
    expect(stored.nativeFile).toBeUndefined();
  });
  it('refuses overlapping Apply operations', async () => {
    const runtime = createArtcraftRuntime(root, 'editors');
    const session = await runtime.open({ editor: 'photo' });
    let resolveInspect!: (value: Awaited<ReturnType<typeof inspectEditor>>) => void;
    vi.mocked(inspectEditor).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInspect = resolve;
        }),
    );
    const pending = runtime.snapshot(session.id);
    await vi.waitFor(() => expect(inspectEditor).toHaveBeenCalled());
    await expect(runtime.snapshot(session.id)).rejects.toThrow('already in progress');
    resolveInspect({
      active: 0,
      revision: 1,
      documentPath: 'working.pcraft',
      widthMm: 100,
      heightMm: 50,
    });
    await pending;
  });
  it('rejects unsupported source media before creating a session', async () => {
    const runtime = createArtcraftRuntime(root, 'editors');
    await expect(
      runtime.open({
        editor: 'photo',
        source: { name: 'bad.svg', mediaType: 'image/svg+xml', dataBase64: 'YQ==' },
      }),
    ).rejects.toThrow('PNG/JPEG');
    expect((await runtime.status()).sessions).toHaveLength(0);
    expect(launchArtcraftProcess).not.toHaveBeenCalled();
  });
});

it('stores native bytes and restores them without the original session cache', async () => {
  const runtime = createArtcraftRuntime(root, 'editors');
  const session = await runtime.open({ editor: 'photo' });
  const portable = await runtime.capture!(session.id);
  expect(Buffer.from(portable.nativeBase64, 'base64').toString()).toBe('layered original');
  const fresh = createArtcraftRuntime(path.join(root, 'fresh-profile'), 'editors');
  const restored = await fresh.restore!(JSON.parse(JSON.stringify(portable)));
  expect(restored.id).not.toBe(session.id);
  expect(restored.documentId).toBe(session.id);
  const exported = await fresh.snapshot(restored.id);
  expect(exported.filename).toBe(`kerfdesk-studio-${session.id}.png`);
});
it('rejects corrupt native bytes before starting an editor', async () => {
  const runtime = createArtcraftRuntime(root, 'editors');
  const session = await runtime.open({ editor: 'photo' });
  const portable = await runtime.capture!(session.id);
  vi.mocked(launchArtcraftProcess).mockClear();
  await expect(runtime.restore!({ ...portable, nativeBase64: 'Y29ycnVwdA==' })).rejects.toThrow(
    'checksum',
  );
  expect(launchArtcraftProcess).not.toHaveBeenCalled();
});
it('reuses identical restored documents concurrently and after restarting the runtime', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const document = await original.capture!(source.id);
  const profile = path.join(root, 'restored-profile');
  const restored = createArtcraftRuntime(profile, 'editors');
  const [first, concurrent] = await Promise.all([
    restored.restore!(document),
    restored.restore!(document),
  ]);
  expect(concurrent.id).toBe(first.id);
  expect((await restored.restore!(document)).id).toBe(first.id);
  const restarted = createArtcraftRuntime(profile, 'editors');
  expect((await restarted.restore!(document)).id).toBe(first.id);
  expect((await restarted.status()).sessions).toHaveLength(1);
});
it('keeps newer working bytes when restoring an older embedded revision', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const document = await original.capture!(source.id);
  const working = path.join(root, 'artcraft-studio', source.id, 'working.pcraft');
  await writeFile(working, 'newer local document');
  const restarted = createArtcraftRuntime(root, 'editors');
  const restored = await restarted.restore!(document);
  expect(restored.id).not.toBe(source.id);
  expect(await readFile(working, 'utf8')).toBe('newer local document');
  expect((await restarted.capture!(restored.id)).nativeSha256).toBe(document.nativeSha256);
  expect((await restarted.restore!(document)).id).toBe(restored.id);
  expect((await restarted.status()).sessions).toHaveLength(2);
});
it('skips a running candidate whose initialization failed and restores embedded bytes', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const document = await original.capture!(source.id);
  const profile = path.join(root, 'failed-profile');
  const restored = createArtcraftRuntime(profile, 'editors');
  vi.mocked(initialiseEditor).mockRejectedValueOnce(new Error('open failed'));
  await expect(restored.restore!(document)).rejects.toThrow('open failed');
  const failed = (await restored.status()).sessions[0]!;
  const recovered = await restored.restore!(document);
  expect(recovered.id).not.toBe(failed.id);
  expect((await restored.capture!(recovered.id)).nativeSha256).toBe(document.nativeSha256);
  expect((await restored.restore!(document)).id).toBe(recovered.id);
  expect((await restored.status()).sessions).toHaveLength(2);
  expect(
    await readFile(path.join(profile, 'artcraft-studio', failed.id, 'working.pcraft'), 'utf8'),
  ).toBe('layered original');
});
it('preserves a disconnected leased session without recovering files in its directory', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const snapshot = await original.snapshot(source.id);
  const directory = path.join(root, 'artcraft-studio', source.id);
  const working = path.join(directory, 'working.pcraft');
  await unlink(working);
  vi.mocked(checkEditorLease).mockImplementation(async (candidate) => {
    if (candidate === directory) throw new Error('The previous editor is still running');
  });
  const restarted = createArtcraftRuntime(root, 'editors');
  const restored = await restarted.restore!(snapshot.nativeDocument);
  expect(checkEditorLease).toHaveBeenCalledWith(directory);
  expect(restored.id).not.toBe(source.id);
  await expect(readFile(working)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(
    await readFile(path.join(directory, 'revisions', snapshot.revision, 'source.pcraft'), 'utf8'),
  ).toBe('layered original');
  expect((await restarted.capture!(restored.id)).nativeSha256).toBe(
    snapshot.nativeDocument?.nativeSha256,
  );
});
it('hashes frozen candidate files without materializing a working file', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const snapshot = await original.snapshot(source.id);
  const working = path.join(root, 'artcraft-studio', source.id, 'working.pcraft');
  await unlink(working);
  const bytes = Buffer.from('different embedded revision');
  const document = {
    ...snapshot.nativeDocument!,
    nativeBase64: bytes.toString('base64'),
    nativeSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const restarted = createArtcraftRuntime(root, 'editors');
  const restored = await restarted.restore!(document);
  expect(restored.id).not.toBe(source.id);
  await expect(readFile(working)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await restarted.capture!(restored.id)).nativeSha256).toBe(document.nativeSha256);
});
it('falls back after a candidate cannot resume but propagates a fresh launch failure', async () => {
  const original = createArtcraftRuntime(root, 'editors');
  const source = await original.open({ editor: 'photo' });
  const document = await original.capture!(source.id);
  const restarted = createArtcraftRuntime(root, 'editors');
  vi.mocked(launchArtcraftProcess).mockRejectedValueOnce(new Error('Candidate lease changed'));
  const restored = await restarted.restore!(document);
  expect(restored.id).not.toBe(source.id);
  expect((await restarted.capture!(restored.id)).nativeSha256).toBe(document.nativeSha256);
  const fresh = createArtcraftRuntime(path.join(root, 'unavailable-profile'), 'editors');
  vi.mocked(launchArtcraftProcess).mockRejectedValueOnce(new Error('Editor cannot launch'));
  await expect(fresh.restore!(document)).rejects.toThrow('Editor cannot launch');
});
it('refuses to checkpoint a document changed while saving', async () => {
  const runtime = createArtcraftRuntime(root, 'editors');
  const session = await runtime.open({ editor: 'photo' });
  vi.mocked(inspectEditor)
    .mockResolvedValueOnce({ active: 0, revision: 1, documentPath: 'working.pcraft' })
    .mockResolvedValueOnce({ active: 0, revision: 2, documentPath: 'working.pcraft' });
  await expect(runtime.capture!(session.id)).rejects.toThrow('changed during Save');
});

it('does not rewrite unchanged native files on periodic checkpoints', async () => {
  const runtime = createArtcraftRuntime(root, 'editors');
  const session = await runtime.open({ editor: 'photo' });
  const original = await runtime.capture!(session.id);
  await writeFile(
    path.join(root, 'artcraft-studio', session.id, 'working.pcraft'),
    'timestamp-only rewrite',
  );
  expect(await runtime.capture!(session.id)).toEqual(original);
  vi.mocked(inspectEditor).mockResolvedValue({
    active: 0,
    revision: 2,
    documentPath: 'working.pcraft',
  });
  expect((await runtime.capture!(session.id)).nativeSha256).not.toBe(original.nativeSha256);
});
