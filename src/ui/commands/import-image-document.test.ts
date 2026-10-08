import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithTwoLines } from '../../__fixtures__/file-actions';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { bindImportActionsToDocument, captureImportDocumentOwner } from '../app/import-dispatch';

const decode = vi.hoisted(() => vi.fn());
vi.mock('../import/qualified-png-raster', () => ({
  shouldPageBackPng: () => true,
  tryDecodeQualifiedPng: decode,
}));
import { importImageFile } from './import-image-action';

beforeEach(() => {
  resetStore();
  decode.mockReset();
});

describe('pending raster import document ownership', () => {
  it('retires staged PNG pages and preserves the next design after New', async () => {
    const rollback = vi.fn(async () => null);
    let finish!: () => void;
    decode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              natural: { width: 2, height: 1 },
              sampled: { width: 2, height: 1 },
              densityDpi: null,
              imageAsset: {
                schemaVersion: 1,
                repository: 'curvedesk-import-assets-v1',
                sourceAssetId: 'old-source-pages',
                lumaAssetId: 'old-luma-pages',
                sourceMimeType: 'image/png',
                sourceByteLength: 100,
                lumaByteLength: 2,
                naturalWidth: 2,
                naturalHeight: 1,
                sampledWidth: 2,
                sampledHeight: 1,
                thumbnail: {
                  mimeType: 'image/bmp',
                  dataUrl: 'data:image/bmp;base64,thumbnail',
                  width: 2,
                  height: 1,
                },
              },
              rollback,
            });
        }),
    );
    const publish = vi.fn(useStore.getState().importRasterImage);
    const getEpoch = () => useStore.getState().projectDocumentEpoch;
    const actions = bindImportActionsToDocument(
      {
        getProjectDocumentEpoch: getEpoch,
        importSvgObject: useStore.getState().importSvgObject,
        importRasterImage: publish,
        pushToast: vi.fn(),
      },
      captureImportDocumentOwner(getEpoch),
    );
    const pending = importImageFile(
      new File(['png'], 'old.png', { type: 'image/png' }),
      actions.importRasterImage,
      actions.pushToast,
    );
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    useStore.getState().newProject();
    useStore.getState().importSvgObject(projectWithTwoLines().scene.objects[0]!);
    finish();
    expect(await pending).toBeNull();
    expect(rollback).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['A']);
    expect(useStore.getState().dirty).toBe(true);
  });
});
