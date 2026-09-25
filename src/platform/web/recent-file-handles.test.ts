import { describe, expect, it, vi } from 'vitest';
import type { RecentFileRef } from '../types';
import { fileHandleFromFile, webRecentFiles } from './recent-file-handles';

type Permission = 'granted' | 'denied' | 'prompt';

function handleRef(options: {
  readonly query?: Permission;
  readonly request?: Permission;
  readonly requestError?: string;
  readonly getFile?: () => Promise<File>;
  readonly isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
  readonly withoutPermissions?: boolean;
}): {
  readonly ref: RecentFileRef;
  readonly queryPermission: ReturnType<typeof vi.fn>;
  readonly requestPermission: ReturnType<typeof vi.fn>;
} {
  const queryPermission = vi.fn(async () => options.query ?? 'granted');
  const requestPermission = vi.fn(async () => {
    if (options.requestError !== undefined) throw domError(options.requestError);
    return options.request ?? 'granted';
  });
  const handle = {
    kind: 'file',
    name: 'sign.lf2',
    getFile:
      options.getFile ??
      (async () => new File(['{}'], 'sign.lf2', { lastModified: 1_700_000_000_123 })),
    ...(options.isSameEntry === undefined ? {} : { isSameEntry: options.isSameEntry }),
    ...(options.withoutPermissions === true ? {} : { queryPermission, requestPermission }),
  } as unknown as FileSystemFileHandle;
  return { ref: { kind: 'handle', handle }, queryPermission, requestPermission };
}

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe('webRecentFiles.open', () => {
  it('reads a handle that still has read permission without prompting', async () => {
    const { ref, requestPermission } = handleRef({ query: 'granted' });

    const result = await webRecentFiles.open(ref);

    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') return;
    expect(result.file).toMatchObject({ name: 'sign.lf2', size: 2 });
    await expect(result.file.blob?.()).resolves.toBeInstanceOf(File);
    expect(result.file.recentRef).toEqual(ref);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks for read permission again after a restart reset it to prompt', async () => {
    const { ref, requestPermission } = handleRef({ query: 'prompt', request: 'granted' });

    const result = await webRecentFiles.open(ref);

    expect(result.kind).toBe('opened');
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('reports a refused permission prompt as denied', async () => {
    const { ref } = handleRef({ query: 'prompt', request: 'denied' });

    await expect(webRecentFiles.open(ref)).resolves.toEqual({ kind: 'denied' });
  });

  it('reports a moved or deleted file as missing', async () => {
    const { ref } = handleRef({
      getFile: async () => {
        throw domError('NotFoundError');
      },
    });

    await expect(webRecentFiles.open(ref)).resolves.toEqual({ kind: 'missing' });
  });

  it('reports a prompt that needed a click as denied, not as a crash', async () => {
    const { ref } = handleRef({ query: 'prompt', requestError: 'SecurityError' });

    await expect(webRecentFiles.open(ref)).resolves.toEqual({ kind: 'denied' });
  });

  it('reads handles from engines without a permission model', async () => {
    const { ref } = handleRef({ withoutPermissions: true });

    await expect(webRecentFiles.open(ref)).resolves.toMatchObject({ kind: 'opened' });
  });

  it('leaves desktop paths to the desktop adapter', async () => {
    const result = await webRecentFiles.open({
      kind: 'desktop-path',
      path: 'C:\\Jobs\\sign.lf2',
      token: 'x'.repeat(43),
    });

    expect(result.kind).toBe('failed');
  });
});

describe('webRecentFiles.probe', () => {
  it('reports size and modification time when the file is readable', async () => {
    const { ref } = handleRef({ query: 'granted' });

    await expect(webRecentFiles.probe(ref)).resolves.toEqual({
      kind: 'present',
      size: 2,
      modifiedMs: 1_700_000_000_123,
    });
  });

  it('never prompts: a handle waiting for permission is unknown', async () => {
    const { ref, requestPermission } = handleRef({ query: 'prompt' });

    await expect(webRecentFiles.probe(ref)).resolves.toEqual({ kind: 'unknown' });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('reports a file that is gone as missing', async () => {
    const { ref } = handleRef({
      getFile: async () => {
        throw domError('NotFoundError');
      },
    });

    await expect(webRecentFiles.probe(ref)).resolves.toEqual({ kind: 'missing' });
  });
});

describe('webRecentFiles.isSameFile', () => {
  it('asks the browser whether two handles name the same entry', async () => {
    const other = handleRef({});
    const isSameEntry = vi.fn(async () => true);
    const first = handleRef({ isSameEntry });

    await expect(webRecentFiles.isSameFile(first.ref, other.ref)).resolves.toBe(true);
    expect(isSameEntry).toHaveBeenCalledOnce();
  });

  it('treats a failing identity check as a different file', async () => {
    const first = handleRef({
      isSameEntry: async () => {
        throw domError('NotAllowedError');
      },
    });

    await expect(webRecentFiles.isSameFile(first.ref, handleRef({}).ref)).resolves.toBe(false);
  });

  it('never matches a handle with a desktop path', async () => {
    const path: RecentFileRef = { kind: 'desktop-path', path: '/jobs/sign.lf2', token: 't' };

    await expect(webRecentFiles.isSameFile(handleRef({}).ref, path)).resolves.toBe(false);
  });
});

describe('fileHandleFromFile', () => {
  it('keeps the handle so the file can join Recent Projects', async () => {
    const { ref } = handleRef({});
    if (ref.kind !== 'handle') throw new Error('expected a handle');
    const file = new File(['abc'], 'part.lf2');

    const handle = fileHandleFromFile(ref.handle, file);

    expect(handle).toMatchObject({ name: 'part.lf2', size: 3 });
    expect(handle.recentRef).toEqual(ref);
    await expect(handle.blob?.()).resolves.toBe(file);
  });
});
