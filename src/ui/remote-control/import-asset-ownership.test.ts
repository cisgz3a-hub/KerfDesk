import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadImageSamples, type LoadedImageSamples } from '../import/prepare-image-samples';
import * as hydration from '../import/svg-image-hydration';
import { makePng } from '../import/png-incremental-decoder.test-support';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { createLayer } from '../../core/scene';
import { loadScene } from '../state/testing/scene-limit-fixtures';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

// Keep parsing, fragment ownership and store transactions real; replace bitmap storage only.
vi.mock('../import/prepare-image-samples', () => ({ loadImageSamples: vi.fn() }));
const png = makePng({ width: 2, height: 1, rows: [[0, 0, 0, 255, 255, 255]] });
const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><image href="${dataUrl}" width="20" height="10"/></svg>`;
const verticalSvg =
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L0 100" stroke="black"/></svg>';
const rollback = vi.fn<() => Promise<string | null>>();
const paged: LoadedImageSamples = {
  kind: 'paged',
  natural: { width: 2, height: 1 },
  sampled: { width: 2, height: 1 },
  density: null,
  rollback,
  imageAsset: {
    schemaVersion: 1,
    repository: 'curvedesk-import-assets-v1',
    sourceAssetId: 'source',
    lumaAssetId: 'luma',
    sourceMimeType: 'image/png',
    sourceByteLength: png.length,
    lumaByteLength: 2,
    naturalWidth: 2,
    naturalHeight: 1,
    sampledWidth: 2,
    sampledHeight: 1,
    thumbnail: {
      mimeType: 'image/bmp',
      dataUrl: 'data:image/bmp;base64,Qk0=',
      width: 2,
      height: 1,
    },
  },
};
let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  vi.stubGlobal('File', NodeFile);
  rollback.mockReset().mockResolvedValue(null);
  vi.mocked(loadImageSamples).mockReset().mockResolvedValue(paged);
  useToastStore.setState({ toasts: [] });
  adapter = testAdapter();
});

it('releases paged raster assets when the desktop refuses the insertion', async () => {
  loadScene(
    [],
    [],
    [],
    Array.from({ length: 256 }, (_, index) =>
      createLayer({
        id: `operation-${index}`,
        color: `#${index.toString(16).padStart(6, '0')}`,
      }),
    ),
  );
  const before = useStore.getState();
  const result = await adapter.execute(
    'import_file',
    writeArgs(adapter, {
      fileName: 'image.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from(png).toString('base64'),
    }),
  );
  expect(resultCode(result)).toBe('failed');
  expect(loadImageSamples).toHaveBeenCalledOnce();
  expect(rollback).toHaveBeenCalledOnce();
  expect(useStore.getState().project).toBe(before.project);
  expect(
    useToastStore.getState().toasts.some((toast) => toast.message.startsWith('Added image:')),
  ).toBe(false);
});
afterEach(() => {
  adapter.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps fragment disposal available after a rejected width placement', async () => {
  const original = hydration.prepareSvgFragment;
  const accept = vi.fn();
  const dispose = vi.fn();
  vi.spyOn(hydration, 'prepareSvgFragment').mockImplementation(async (...args) => {
    const prepared = await original(...args);
    return {
      objects: prepared.objects,
      commit: () => {
        accept();
        prepared.commit();
      },
      rollback: async () => {
        dispose();
        await prepared.rollback();
      },
    };
  });
  const before = useStore.getState();
  const result = await adapter.execute(
    'add_svg',
    writeArgs(adapter, { svg: verticalSvg, widthMm: 25 }),
  );
  expect(resultCode(result)).toBe('unsupported_operation');
  expect(accept).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  expect(useStore.getState().project).toBe(before.project);
});

it('releases hydrated bitmap assets when a later batch edit rolls back the import', async () => {
  const before = useStore.getState();
  const result = await adapter.execute(
    'apply_edits',
    writeArgs(adapter, {
      edits: [
        { command: 'add_svg', args: { svg: imageSvg, widthMm: 25 } },
        { command: 'add_svg', args: { svg: verticalSvg, widthMm: 25 } },
      ],
    }),
  );
  expect(resultCode(result)).toBe('unsupported_operation');
  expect(loadImageSamples).toHaveBeenCalledOnce();
  expect(rollback).toHaveBeenCalledOnce();
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toBe(before.undoStack);
});

it.each(['add_svg', 'apply_edits'])(
  'keeps hydrated bitmap assets after successful %s',
  async (command) => {
    const args = { svg: imageSvg, widthMm: 25 };
    const result = await adapter.execute(
      command,
      writeArgs(
        adapter,
        command === 'add_svg'
          ? args
          : {
              edits: [{ command: 'add_svg', args }],
            },
      ),
    );
    expect(resultCode(result)).toBe('ok');
    expect(loadImageSamples).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      kind: 'raster-image',
      imageAsset: paged.imageAsset,
    });
  },
);
