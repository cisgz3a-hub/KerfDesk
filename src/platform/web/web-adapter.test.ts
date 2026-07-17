import { afterEach, describe, expect, it, vi } from 'vitest';
import { webAdapter } from './web-adapter';

const originalSavePickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');

const saveRequest = { suggestedName: 'out.gcode', extensions: ['.gcode'] };

afterEach(() => {
  if (originalSavePickerDescriptor === undefined) {
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  } else {
    Object.defineProperty(window, 'showSaveFilePicker', originalSavePickerDescriptor);
  }
  vi.restoreAllMocks();
});

describe('webAdapter save target', () => {
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

  it('reports unsupported browsers with a clear File System Access error', async () => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });

    await expect(webAdapter.pickFileForSave(saveRequest)).rejects.toThrow(/File System Access API/);
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

function installSavePicker(writable: WritableMock): void {
  const handle = {
    kind: 'file',
    name: 'out.gcode',
    getFile: vi.fn(async () => new File([], 'out.gcode')),
    createWritable: vi.fn(async () => writable as unknown as FileSystemWritableFileStream),
  } as unknown as FileSystemFileHandle;
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: vi.fn(async () => handle),
  });
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
