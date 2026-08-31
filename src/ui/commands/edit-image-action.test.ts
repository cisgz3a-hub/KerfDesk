import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { editImageAction } from './edit-image-action';

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

beforeEach(() => {
  vi.clearAllMocks();
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

describe('editImageAction document ownership', () => {
  it('does not import or open Studio after a same-id replacement document opens', async () => {
    const decode = deferred<undefined>();
    const staleImage = { id: 'shared-id', kind: 'raster-image' } as SceneObject;
    calls.pickPlatformImageFile.mockResolvedValue(
      new File(['png'], 'late.png', { type: 'image/png' }),
    );
    calls.importImageFile.mockImplementation(async (_file, importRasterImage, pushToast) => {
      await decode.promise;
      try {
        importRasterImage(staleImage);
      } catch {
        // The real import path catches the stale owner at its scene-mutation boundary.
      }
      pushToast('late edit-image completion', 'error');
      return staleImage;
    });
    let epoch = 21;
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();
    const run = editImageAction(
      platform(),
      null,
      () => epoch,
      vi.fn(() => ({ kind: 'added' as const })),
      importRasterImage,
      pushToast,
    );

    run();
    await vi.waitFor(() => expect(calls.importImageFile).toHaveBeenCalledOnce());
    epoch += 1;
    decode.resolve(undefined);
    await vi.waitFor(() => expect(calls.importImageFile).toHaveResolved());

    expect(importRasterImage).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
    expect(useImageEditorStore.getState().session).toBeNull();
  });
});
