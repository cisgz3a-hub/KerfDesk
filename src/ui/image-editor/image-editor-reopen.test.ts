// Reopening a closed Image Studio session (ADR-311 Amendment 2, audit
// 23-P2-3): placement changes keep it, a changed image says it discarded it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import { useImageEditorStore } from './image-editor-store';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));

const ORIGINAL_APPLY_EDITED_IMAGE = useStore.getState().applyEditedImage;

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function projectWithRaster(image: RasterImage): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [image] } };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetStore();
  vi.mocked(decodeRasterToBuffer).mockReset();
  vi.mocked(bakeBufferToBitmapFields).mockReset();
  useStore.setState({ applyEditedImage: vi.fn() });
  useImageEditorStore.setState({
    session: null,
    sessionOwner: null,
    stash: {},
    loadState: { kind: 'idle' },
    isApplying: false,
    applyRequest: null,
    pendingCrop: null,
    transform: null,
  });
});

afterEach(() => {
  useStore.setState({ applyEditedImage: ORIGINAL_APPLY_EDITED_IMAGE });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('Image Studio reopen after Close', () => {
  it('resumes a closed session after the image is nudged and applies onto the moved image', async () => {
    const image = raster('nudged-image');
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    vi.mocked(bakeBufferToBitmapFields).mockResolvedValue({
      dataUrl: 'data:image/png;base64,applied',
      lumaBase64: 'AAA=',
    });
    useStore.setState({
      project: projectWithRaster(image),
      projectDocumentEpoch: 10,
      applyEditedImage: ORIGINAL_APPLY_EDITED_IMAGE,
    });
    useImageEditorStore.getState().openEditor(image);
    await settle();
    useImageEditorStore.setState({
      tool: { kind: 'pencil' },
      brush: { diameterPx: 1, hardness: 1, opacity: 1 },
      foreground: { r: 0, g: 0, b: 0 },
    });
    useImageEditorStore.getState().stroke([{ x: 0, y: 0 }]);
    useImageEditorStore.getState().closeEditor();

    useStore.getState().selectObject(image.id);
    useStore.getState().nudgeSelection(1, 0);
    const moved = useStore.getState().project.scene.objects[0];
    if (moved?.kind !== 'raster-image') throw new Error('Nudged image missing');
    expect(moved).not.toBe(image);
    expect(moved.transform.x).toBe(1);
    useImageEditorStore.getState().openEditor(moved);

    expect(decodeRasterToBuffer).toHaveBeenCalledOnce();
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(true);
    expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    useImageEditorStore.getState().apply();
    await settle();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      dataUrl: 'data:image/png;base64,applied',
      transform: { x: 1 },
    });
  });

  it('says so when a change to the image itself discards the kept session', async () => {
    const image = raster('cropped-image');
    const docA = createRgbaBuffer(4, 4);
    const docB = createRgbaBuffer(4, 4);
    vi.mocked(decodeRasterToBuffer).mockResolvedValueOnce(docA).mockResolvedValueOnce(docB);
    useStore.setState({ project: projectWithRaster(image), projectDocumentEpoch: 12 });
    useImageEditorStore.getState().openEditor(image);
    await settle();
    useImageEditorStore.setState((state) => ({
      session:
        state.session === null ? null : { ...state.session, revision: 2, dirtySinceApply: true },
    }));
    useImageEditorStore.getState().closeEditor();

    const replaced = { ...image, dataUrl: 'data:image/png;base64,cropped' };
    useStore.setState({ project: projectWithRaster(replaced), projectDocumentEpoch: 12 });
    useImageEditorStore.getState().openEditor(replaced);
    await settle();

    expect(decodeRasterToBuffer).toHaveBeenCalledTimes(2);
    expect(useImageEditorStore.getState().session?.doc).toBe(docB);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'warning',
        message: expect.stringContaining('unapplied edits were discarded'),
      }),
    ]);
  });
});
