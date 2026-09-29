import { describe, expect, it, vi } from 'vitest';
import type { SaveTarget } from '../types';
import { webAdapter } from './web-adapter';

type PermissionAnswer = PermissionState | Error;

function openedHandle(name: string, query?: PermissionState, request: PermissionAnswer = 'denied') {
  const writable = {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
  const createWritable = vi.fn(async () => writable);
  const requestPermission = vi.fn(async () => {
    if (request instanceof Error) throw request;
    return request;
  });
  const handle = {
    kind: 'file',
    name,
    createWritable,
    ...(query === undefined
      ? {}
      : { queryPermission: vi.fn(async () => query), requestPermission }),
  } as unknown as FileSystemFileHandle;
  return { handle, writable, createWritable, requestPermission };
}

function targetFor(handle: FileSystemFileHandle): SaveTarget {
  const target = webAdapter.openedProjectSaveTarget?.({ kind: 'handle', handle });
  if (target === null || target === undefined) throw new Error('expected a save target');
  return target;
}

describe('saving over a project opened from a handle (ADR-550)', () => {
  it('offers a target only for KerfDesk projects the browser can reach', () => {
    const lightBurn = openedHandle('sign.lbrn2');
    expect(
      webAdapter.openedProjectSaveTarget?.({ kind: 'handle', handle: lightBurn.handle }),
    ).toBeNull();
    expect(
      webAdapter.openedProjectSaveTarget?.({ kind: 'desktop-path', path: 'C:\\a.lf2', token: 't' }),
    ).toBeNull();
  });

  it('asks to change the file on the first write, then writes it', async () => {
    const opened = openedHandle('Sign.LF2', 'prompt', 'granted');
    const target = targetFor(opened.handle);

    expect(target.displayName).toBe('Sign.LF2');
    expect(target.recentRef).toEqual({ kind: 'handle', handle: opened.handle });
    await target.write('{}');

    expect(opened.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(opened.writable.write).toHaveBeenCalledWith('{}');
    expect(opened.writable.close).toHaveBeenCalledOnce();
  });

  it('writes without asking when changing the file is already allowed', async () => {
    const opened = openedHandle('sign.lf2', 'granted');
    await targetFor(opened.handle).write('{}');
    expect(opened.requestPermission).not.toHaveBeenCalled();
    expect(opened.writable.write).toHaveBeenCalledWith('{}');
  });

  it.each<PermissionAnswer>(['denied', 'prompt', new DOMException('No gesture', 'SecurityError')])(
    'refuses clearly without touching the file when not allowed (%s)',
    async (answer) => {
      const opened = openedHandle('sign.lf2', 'prompt', answer);
      await expect(targetFor(opened.handle).write('{}')).rejects.toThrow(
        'KerfDesk may not change sign.lf2. Use Save As to save a copy.',
      );
      expect(opened.createWritable).not.toHaveBeenCalled();
    },
  );

  it('leaves the refusal to the write where the engine has no permission model', async () => {
    const opened = openedHandle('sign.lf2');
    await targetFor(opened.handle).write('{}');
    expect(opened.writable.write).toHaveBeenCalledWith('{}');
  });
});
