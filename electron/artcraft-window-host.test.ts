import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mocks.spawn, default: { ...actual, spawn: mocks.spawn } };
});
import { ArtcraftWindowChannel } from './artcraft-window-channel.js';
import {
  createArtcraftWindowHost,
  nativeHandleString,
  validateArtcraftWindowRect,
} from './artcraft-window-host.js';
const rect = { x: 10, y: 80, width: 780, height: 510, viewportWidth: 800, viewportHeight: 600 };
const originalPlatform = process.platform;
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
}
let child: ReturnType<typeof fakeChild>;
let requests: Array<Record<string, unknown>>;
beforeEach(() => {
  mocks.spawn.mockClear();
  child = fakeChild();
  requests = [];
  child.stdin.on('data', (chunk: Buffer) =>
    requests.push(JSON.parse(chunk.toString()) as Record<string, unknown>),
  );
  mocks.spawn.mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});
function reply(index: number, result: unknown = null): void {
  child.stdout.write(JSON.stringify({ id: requests[index]?.['id'], ok: true, result }) + '\n');
}
describe('native editor host boundary', () => {
  it('verifies detachment through a fresh helper after the original helper exits', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const host = createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1');
    child.emit('exit', 1);
    const replacement = fakeChild();
    const methods: string[] = [];
    replacement.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString()) as { id: string; method: string };
      methods.push(request.method);
      replacement.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\n');
    });
    mocks.spawn.mockReturnValue(replacement);
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(methods).toEqual(['verifyDetached']);
    expect(replacement.stdin.writableEnded).toBe(true);
    expect(replacement.kill).toHaveBeenCalledOnce();
  });
  it('keeps disposal retryable while an orphan editor remains attached', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const host = createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1');
    child.emit('exit', 1);
    let orphanRemains = true;
    const probes: ReturnType<typeof fakeChild>[] = [];
    mocks.spawn.mockImplementation(() => {
      const probe = fakeChild();
      probes.push(probe);
      probe.stdin.on('data', (chunk: Buffer) => {
        const request = JSON.parse(chunk.toString()) as { id: string; method: string };
        const blocked = request.method === 'verifyDetached' && orphanRemains;
        probe.stdout.write(
          JSON.stringify({ id: request.id, ok: !blocked, error: 'Editor remains attached' }) + '\n',
        );
      });
      return probe;
    });
    await expect(host.dispose()).rejects.toThrow('Editor remains attached');
    expect(probes[0]?.stdin.writableEnded).toBe(true);
    orphanRemains = false;
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(probes).toHaveLength(2);
    expect(probes[1]?.stdin.writableEnded).toBe(true);
  });
  it('does not bypass a broken channel while its original helper could still attach a window', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const host = createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1');
    child.stdin.emit('error', new Error('pipe lost'));
    await expect(host.dispose()).rejects.toThrow('unconfirmed');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
  it('terminates a timed-out read-only probe without retaining its streams or process', async () => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const host = createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1');
    child.emit('exit', 1);
    const probe = fakeChild();
    mocks.spawn.mockReturnValue(probe);
    const check = expect(host.dispose()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(probe.stdin.writableEnded).toBe(true);
    expect(probe.stdout.destroyed).toBe(true);
    expect(probe.stderr.destroyed).toBe(true);
    expect(probe.kill).toHaveBeenCalledOnce();
    expect(probe.unref).toHaveBeenCalledOnce();
  });
  it('retains the full unsigned native handle and rejects unsupported sizes', () => {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(0x123456789abcdef0n);
    expect(nativeHandleString(handle)).toBe('1311768467463790320');
    expect(() => nativeHandleString(Buffer.alloc(3))).toThrow('Unsupported');
  });
  it.each([
    { ...rect, x: -1 },
    { ...rect, width: 0 },
    { ...rect, height: Infinity },
    { ...rect, viewportWidth: NaN },
    { ...rect, width: 900 },
  ])('rejects malformed/outside bounds before touching a window', (value) => {
    expect(() => validateArtcraftWindowRect(value)).toThrow();
  });
  it('rejects untrusted session keys and identity before sending attach', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const host = createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1');
    const identity = { pid: 4, startTime: '123', executable: 'C:\\editor.exe' };
    await expect(host.attach('../other', identity, rect)).rejects.toThrow('session');
    await expect(host.attach('one', { ...identity, pid: -1 }, rect)).rejects.toThrow('identity');
    expect(requests).toEqual([]);
  });
  it.each(['linux', 'darwin'])('rejects %s before starting the native helper', (platform) => {
    Object.defineProperty(process, 'platform', { value: platform });
    expect(() => createArtcraftWindowHost(Buffer.from([1, 0, 0, 0]), 'helper.ps1')).toThrow(
      'Embedded desktop editors require Windows',
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
describe('persistent native host channel', () => {
  it('does not use read-only probe cleanup on a channel that could own editor windows', async () => {
    const channel = new ArtcraftWindowChannel('helper.ps1', '1', 42);
    const attach = channel.request('attach', 'session');
    reply(0);
    await attach;
    expect(() => channel.stopReadOnlyProbe()).toThrow('without detaching');
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('uses hidden noninteractive PowerShell and main-owned host identity', () => {
    new ArtcraftWindowChannel('helper.ps1', '123456', 42);
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      expect.stringMatching(/powershell.exe$/),
      expect.arrayContaining(['-NonInteractive', '-File', 'helper.ps1']),
      expect.objectContaining({
        windowsHide: true,
        env: expect.objectContaining({
          KERFDESK_WINDOW_HOST_PID: '42',
          KERFDESK_WINDOW_HOST_HWND: '123456',
        }),
      }),
    );
  });
  it('joins chunked replies and matches concurrent requests by id', async () => {
    const channel = new ArtcraftWindowChannel('helper.ps1', '1', 42);
    const first = channel.request('layout', 'first');
    const second = channel.request('hide', 'second');
    reply(1, 'second result');
    const line =
      JSON.stringify({ id: requests[0]?.['id'], ok: true, result: 'first result' }) + '\n';
    child.stdout.write(line.slice(0, 7));
    child.stdout.write(line.slice(7));
    await expect(first).resolves.toBe('first result');
    await expect(second).resolves.toBe('second result');
  });
  it('does not report disposal success when detachment fails', async () => {
    const channel = new ArtcraftWindowChannel('helper.ps1', '1', 42);
    const disposal = channel.dispose();
    child.stdout.write(
      JSON.stringify({ id: requests[0]?.['id'], ok: false, error: 'SetParent failed' }) + '\n',
    );
    await expect(disposal).rejects.toThrow('SetParent failed');
    expect(child.stdin.writableEnded).toBe(false);
    const retry = channel.dispose();
    reply(1);
    await retry;
    expect(child.stdin.writableEnded).toBe(true);
  });
  it('refuses to confirm detachment after unexpected helper loss', async () => {
    const channel = new ArtcraftWindowChannel('helper.ps1', '1', 42);
    child.emit('exit', 1);
    await expect(channel.dispose()).rejects.toThrow('unconfirmed');
  });
  it('bounds malformed helper output and rejects pending callers', async () => {
    const channel = new ArtcraftWindowChannel('helper.ps1', '1', 42);
    const request = channel.request('layout', 'first');
    child.stdout.write('x'.repeat(65537));
    await expect(request).rejects.toThrow('limit');
  });
});
