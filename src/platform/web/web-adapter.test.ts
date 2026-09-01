import { afterEach, describe, expect, it, vi } from 'vitest';
import { webAdapter } from './web-adapter';

const originalSavePickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
const originalDirectoryPickerDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'showDirectoryPicker',
);

const saveRequest = { suggestedName: 'out.gcode', extensions: ['.gcode'] };

afterEach(() => {
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
  it('does not open or truncate the file until prepared data is written', async () => {
    const writable = writableStreamMock();
    const createWritable = installSavePicker(writable);

    const target = await webAdapter.pickFileForSave(saveRequest);
    if (target === null) throw new Error('expected save target');
    expect(createWritable).not.toHaveBeenCalled();

    await target.write('G21\n');
    expect(createWritable).toHaveBeenCalledOnce();
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

  it('reports unsupported browsers with a clear File System Access error', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });

    await expect(webAdapter.pickFileForSave(saveRequest)).rejects.toThrow(/File System Access API/);
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
    ).rejects.toThrow(/File System Access API/);
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
