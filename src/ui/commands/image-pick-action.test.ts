import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { runImagePickAction } from './image-pick-action';

const calls = vi.hoisted(() => ({
  importImageFile: vi.fn(),
  pickPlatformImageFile: vi.fn(),
}));

vi.mock('./import-image-action', () => ({ importImageFile: calls.importImageFile }));
vi.mock('./platform-image-files', () => ({
  pickPlatformImageFile: calls.pickPlatformImageFile,
}));

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function platform(): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('runImagePickAction document ownership', () => {
  it('silently discards a picker result after the project document is replaced', async () => {
    const picker = deferred<File | null>();
    calls.pickPlatformImageFile.mockReturnValue(picker.promise);
    let epoch = 7;
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    const pending = runImagePickAction({
      platform: platform(),
      getProjectDocumentEpoch: () => epoch,
      importSvgObject: vi.fn(() => ({ kind: 'added' as const })),
      importRasterImage,
      pushToast,
    });
    epoch += 1;
    picker.resolve(new File(['png'], 'late.png', { type: 'image/png' }));
    await pending;

    expect(calls.importImageFile).not.toHaveBeenCalled();
    expect(importRasterImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('silently discards decode completion after a same-id replacement document opens', async () => {
    const decode = deferred<undefined>();
    calls.pickPlatformImageFile.mockResolvedValue(
      new File(['png'], 'late.png', { type: 'image/png' }),
    );
    calls.importImageFile.mockImplementation(async (_file, importRasterImage, pushToast) => {
      await decode.promise;
      try {
        importRasterImage({ id: 'shared-id' } as SceneObject);
      } catch {
        // The document owner rejects the stale completion; the import path then
        // attempts its normal diagnostic toast, which must be suppressed too.
      }
      pushToast('late image completion', 'error');
      return null;
    });
    let epoch = 11;
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    const pending = runImagePickAction({
      platform: platform(),
      getProjectDocumentEpoch: () => epoch,
      importSvgObject: vi.fn(() => ({ kind: 'added' as const })),
      importRasterImage,
      pushToast,
    });
    await vi.waitFor(() => expect(calls.importImageFile).toHaveBeenCalledOnce());
    epoch += 1;
    decode.resolve(undefined);
    await pending;

    expect(importRasterImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});
