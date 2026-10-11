// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchArtcraftProcess } from './artcraft-process';
import { ArtcraftSessionUnavailableError } from './artcraft-session-unavailable';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  check: vi.fn(),
  save: vi.fn(),
  request: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(async () => undefined) }));
vi.mock('./artcraft-process-lease.js', () => ({
  checkEditorLease: mocks.check,
  saveEditorLease: mocks.save,
}));
vi.mock('./artcraft-client.js', () => ({ artcraftRequest: mocks.request }));

function child(pid: number | undefined = 42) {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    unref: vi.fn(),
    kill: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('editor launch failure ownership', () => {
  it('distinguishes a candidate lease failure before launching a process', async () => {
    const cause = new Error('The previous editor is still running');
    mocks.check.mockRejectedValueOnce(cause);
    await expect(
      launchArtcraftProcess('editor.exe', 'photo', 'owned-candidate'),
    ).rejects.toMatchObject({
      constructor: ArtcraftSessionUnavailableError,
      cause,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('unrefs an unrecorded child and blocks retries until that child exits', async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process as unknown as ChildProcess);
    mocks.save.mockRejectedValueOnce(new Error('Disk full'));
    await expect(
      launchArtcraftProcess('editor.exe', 'photo', 'lease-write-failure'),
    ).rejects.toThrow('Close its native window');
    expect(process.unref).toHaveBeenCalled();
    expect(process.kill).not.toHaveBeenCalled();
    await expect(
      launchArtcraftProcess('editor.exe', 'photo', 'lease-write-failure'),
    ).rejects.toThrow('still running');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    process.emit('exit', 0);
    const retry = await launchArtcraftProcess('editor.exe', 'photo', 'lease-write-failure');
    expect(retry.running()).toBe(true);
    process.emit('exit', 0);
  });

  it('releases ownership after a spawn error with no child PID', async () => {
    const failed = child();
    failed.pid = undefined;
    const next = child(43);
    mocks.spawn.mockReturnValueOnce(failed).mockReturnValueOnce(next);
    mocks.save.mockImplementationOnce(async () => {
      failed.emit('error', new Error('ENOENT'));
      throw new Error('Native editor did not start');
    });
    await expect(launchArtcraftProcess('editor.exe', 'vector', 'spawn-failure')).rejects.toThrow(
      'Could not record',
    );
    await expect(
      launchArtcraftProcess('editor.exe', 'vector', 'spawn-failure'),
    ).resolves.toBeDefined();
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    next.emit('exit', 0);
  });
});
