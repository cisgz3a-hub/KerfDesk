import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromiumDirectory, installChromiumSavePicker } from './chromium-save-picker.test-support';
import { BROWSER_CANNOT_OPEN_FILES, BROWSER_CANNOT_SAVE_FILES, webAdapter } from './web-adapter';

const originalSavePickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
const originalDirectoryPickerDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'showDirectoryPicker',
);

const saveRequest = { suggestedName: 'out.gcode', extensions: ['.gcode'] };
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function setUrlMember(name: 'createObjectURL' | 'revokeObjectURL', value: unknown): void {
  Object.defineProperty(URL, name, { configurable: true, writable: true, value });
}

function restoreUrlMember(
  name: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) Reflect.deleteProperty(URL, name);
  else Object.defineProperty(URL, name, descriptor);
}

afterEach(() => {
  restoreUrlMember('createObjectURL', originalCreateObjectUrl);
  restoreUrlMember('revokeObjectURL', originalRevokeObjectUrl);
  if (originalSavePickerDescriptor === undefined) {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  } else {
    Object.defineProperty(window, 'showSaveFilePicker', originalSavePickerDescriptor);
  }
  if (originalDirectoryPickerDescriptor === undefined) {
    Reflect.deleteProperty(window, 'showDirectoryPicker');
  } else {
    Object.defineProperty(window, 'showDirectoryPicker', originalDirectoryPickerDescriptor);
  }
  vi.restoreAllMocks();
});

describe('webAdapter save target', () => {
  it('lists only immediate files without opening or modifying their contents', async () => {
    const getFileHandle = vi.fn();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => ({
        getFileHandle,
        entries: async function* () {
          yield ['old_tile-r1-c1.nc', { kind: 'file' }];
          yield ['nested_tile-r1-c1.nc', { kind: 'directory' }];
        },
      }),
    });
    const directory = await webAdapter.reserveSaveDirectory?.();
    await expect(directory?.listFiles?.()).resolves.toEqual(['old_tile-r1-c1.nc']);
    expect(getFileHandle).not.toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'NotReadableError'])(
    'propagates %s from a directory existence probe',
    async (name) => {
      const error = new DOMException('Cannot inspect directory', name);
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: vi.fn(async () => ({
          getFileHandle: vi.fn(async () => {
            throw error;
          }),
        })),
      });
      const directory = await webAdapter.reserveSaveDirectory?.();
      await expect(directory?.exists?.('a-trace.svg')).rejects.toBe(error);
    },
  );

  it('hands back a chosen file that Chromium has already emptied (ADR-656)', async () => {
    // The old test here asserted "does not truncate" against a picker that
    // could not truncate (audit 19-P2-1). Chromium empties the file on pick, so
    // the contract callers rely on is the opposite: prepare before picking.
    const disk = new Map([['out.gcode', 'G21\n(previous program)\n']]);
    const picker = installChromiumSavePicker(disk);
    try {
      const target = await webAdapter.pickFileForSave(saveRequest);
      if (target === null) throw new Error('expected save target');
      expect(disk.get('out.gcode')).toBe('');

      await target.write('G21\nG90\n');
      expect(disk.get('out.gcode')).toBe('G21\nG90\n');
    } finally {
      picker.restore();
    }
  });

  it('aborts the writable stream when a save write fails', async () => {
    const writable = writableStreamMock({ writeError: new Error('disk full') });
    installSavePicker(writable);

    const target = await webAdapter.pickFileForSave(saveRequest);
    if (target === null) throw new Error('expected save target');

    await expect(target.write('G21\n')).rejects.toThrow(/disk full/);
    expect(writable.write).toHaveBeenCalledWith('G21\n');
    expect(writable.close).not.toHaveBeenCalled();
    expect(writable.abort).toHaveBeenCalledTimes(1);
  });

  it('compares separately picked handles with the browser entry identity contract', async () => {
    const secondHandle = { kind: 'file', name: 'out.gcode' } as FileSystemFileHandle;
    const isSameEntry = vi.fn(async (other: FileSystemHandle) => other === secondHandle);
    const firstHandle = {
      kind: 'file',
      name: 'out.gcode',
      isSameEntry,
    } as unknown as FileSystemFileHandle;
    const handles = [firstHandle, secondHandle];
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => {
        const handle = handles.shift();
        if (handle === undefined) throw new Error('No picker handle remains.');
        return handle;
      }),
    });

    const first = await webAdapter.pickFileForSave(saveRequest);
    const second = await webAdapter.pickFileForSave(saveRequest);
    if (first === null || second === null) throw new Error('expected save targets');

    await expect(first.isSameDestination?.(second)).resolves.toBe(true);
    expect(isSameEntry).toHaveBeenCalledWith(secondHandle);
  });

  it('downloads instead where there is no save picker (ADR-688 Amendment 2)', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
    setUrlMember(
      'createObjectURL',
      vi.fn(() => 'blob:kerfdesk/1'),
    );
    setUrlMember('revokeObjectURL', vi.fn());
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    expect(webAdapter.savesByDownload?.()).toBe(true);
    const target = await webAdapter.pickFileForSave(saveRequest);
    expect(target?.delivery).toBe('download');
    expect(target?.displayName).toBe(saveRequest.suggestedName);
    await target?.write('bytes');
    expect(click).toHaveBeenCalledTimes(1);

    // A multi-file export downloads each file of the set.
    const folder = await webAdapter.reserveSaveDirectory?.();
    expect(folder?.file('tile-1.nc').delivery).toBe('download');
    await expect(folder?.exists?.('tile-1.nc')).resolves.toBe(false);
  });

  it('names a browser that can save where it can neither pick nor download (ADR-688)', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    setUrlMember('createObjectURL', undefined);

    expect(webAdapter.savesByDownload?.()).toBe(false);
    await expect(webAdapter.pickFileForSave(saveRequest)).rejects.toThrow(
      BROWSER_CANNOT_SAVE_FILES,
    );
  });

  it('keeps an operator-chosen filename without creating the destination until write', async () => {
    const writable = writableStreamMock();
    const createWritable = vi.fn(async () => writable as unknown as FileSystemWritableFileStream);
    const getFileHandle = vi.fn(async () => ({ name: 'out.gcode', createWritable }));
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => ({ getFileHandle })),
    });
    const chooseName = vi.fn(async () => 'custom-name.nc');

    const target = await webAdapter.reserveFileForSave?.({ ...saveRequest, chooseName });
    if (target === null || target === undefined) throw new Error('expected reserved target');
    expect(chooseName).toHaveBeenCalledWith('out.gcode');
    expect(getFileHandle).not.toHaveBeenCalled();

    await target.write('G21\n');

    expect(target.displayName).toBe('custom-name.nc');
    expect(getFileHandle).toHaveBeenCalledWith('custom-name.nc', { create: true });
    expect(createWritable).toHaveBeenCalledOnce();
    expect(writable.write).toHaveBeenCalledWith('G21\n');
  });

  it('removes the entry a failed folder write created, leaving no empty file', async () => {
    const disk = new Map<string, string>();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chromiumDirectory(disk, { writeError: new Error('disk full') })),
    });

    const directory = await webAdapter.reserveSaveDirectory?.();
    await expect(directory?.file('logo-trace.svg').write('<svg/>')).rejects.toThrow('disk full');

    expect([...disk.keys()]).toEqual([]);
    await expect(directory?.exists?.('logo-trace.svg')).resolves.toBe(false);
  });

  it('keeps an existing file and its contents when a folder write over it fails', async () => {
    const disk = new Map([['tile-1.gcode', 'G21\n(previous tile)\n']]);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => chromiumDirectory(disk, { writeError: new Error('disk full') })),
    });

    const directory = await webAdapter.reserveSaveDirectory?.();
    await expect(directory?.file('tile-1.gcode').write('G21\n')).rejects.toThrow('disk full');

    expect(disk.get('tile-1.gcode')).toBe('G21\n(previous tile)\n');
  });

  it('reserves a reusable directory without creating any tile target', async () => {
    const getFileHandle = vi.fn();
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: vi.fn(async () => ({ getFileHandle })),
    });

    const directory = await webAdapter.reserveSaveDirectory?.();

    expect(directory).not.toBeNull();
    expect(getFileHandle).not.toHaveBeenCalled();
  });
});

describe('webAdapter open picker', () => {
  const originalOpenPickerDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'showOpenFilePicker',
  );

  afterEach(() => {
    if (originalOpenPickerDescriptor === undefined) {
      Reflect.deleteProperty(window, 'showOpenFilePicker');
    } else {
      Object.defineProperty(window, 'showOpenFilePicker', originalOpenPickerDescriptor);
    }
  });

  it('reports unsupported browsers with the same clear error as the save path', async () => {
    // The module contract says unsupported browsers "fail clearly"; without a
    // capability check this was a raw TypeError (audit 2026-07-17-0715 P3-2).
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });

    await expect(
      webAdapter.pickFilesForOpen({ multiple: false, accept: ['.lf2'] }),
    ).rejects.toThrow(BROWSER_CANNOT_OPEN_FILES);
  });

  it('remembers the picked handle so Recent Projects can reopen the file', async () => {
    const handle = {
      kind: 'file',
      name: 'sign.lf2',
      getFile: vi.fn(async () => new File(['{}'], 'sign.lf2')),
    } as unknown as FileSystemFileHandle;
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: vi.fn(async () => [handle]),
    });

    const [file] = await webAdapter.pickFilesForOpen({ multiple: false, accept: ['.lf2'] });

    expect(file?.recentRef).toEqual({ kind: 'handle', handle });
    expect(webAdapter.recentFiles).toBeDefined();
  });
});

describe('webAdapter save target identity for Recent Projects', () => {
  it('carries the chosen handle on the save target', async () => {
    installSavePicker(writableStreamMock());

    const target = await webAdapter.pickFileForSave(saveRequest);

    expect(target?.recentRef).toMatchObject({ kind: 'handle', handle: { name: 'out.gcode' } });
  });
});

function installSavePicker(writable: WritableMock): ReturnType<typeof vi.fn> {
  const createWritable = vi.fn(async () => writable as unknown as FileSystemWritableFileStream);
  const handle = {
    kind: 'file',
    name: 'out.gcode',
    getFile: vi.fn(async () => new File([], 'out.gcode')),
    createWritable,
  } as unknown as FileSystemFileHandle;
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: vi.fn(async () => handle),
  });
  return createWritable;
}

type WritableMock = {
  readonly write: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly abort: ReturnType<typeof vi.fn>;
};

function writableStreamMock(options: { readonly writeError?: Error } = {}): WritableMock {
  return {
    write: vi.fn(async () => {
      if (options.writeError !== undefined) throw options.writeError;
    }),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
}
