import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneObject } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { editImageAction } from './edit-image-action';

const calls = vi.hoisted(() => ({ runImagePickAction: vi.fn() }));
vi.mock('./image-pick-action', () => ({ runImagePickAction: calls.runImagePickAction }));

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

const platform = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
} satisfies PlatformAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  useImageEditorStore.setState({ session: null, sessionOwner: null, transform: null });
});

describe('editImageAction result ownership', () => {
  it('rechecks the epoch after the owned picker resolves and before opening Studio', async () => {
    const picked = deferred<SceneObject | null>();
    const staleImage = { id: 'shared-id', kind: 'raster-image' } as SceneObject;
    calls.runImagePickAction.mockReturnValue(picked.promise);
    let epoch = 5;
    const run = editImageAction(
      platform,
      null,
      () => epoch,
      vi.fn(() => ({ kind: 'added' as const })),
      vi.fn(),
      vi.fn(),
    );

    run();
    picked.resolve(staleImage);
    epoch += 1;
    await picked.promise;
    await Promise.resolve();

    expect(useImageEditorStore.getState().session).toBeNull();
  });
});
