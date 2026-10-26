import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { decodeRasterToBuffer } from './image-editor-decode';
import { useImageEditorStore } from './image-editor-store';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));

const BOUNDS = { minX: 0, minY: 0, maxX: 4, maxY: 4 };

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function setCurrentImages(...images: ReadonlyArray<RasterImage>): void {
  const project = createProject();
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: images } },
    projectDocumentEpoch: 1,
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetStore();
  vi.mocked(decodeRasterToBuffer).mockReset();
  useImageEditorStore.setState({
    session: null,
    sessionOwner: null,
    stash: {},
    loadState: { kind: 'idle' },
    isApplying: false,
    applyRequest: null,
    pendingCrop: null,
    transform: null,
    tool: { kind: 'brush' },
  });
});

describe('Image Studio clone source ownership', () => {
  it('retires clone source readiness when closing and opening another image', async () => {
    const first = raster('clone-first');
    const second = raster('clone-second');
    setCurrentImages(first, second);
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    useImageEditorStore.getState().openEditor(first);
    await settle();
    useImageEditorStore.getState().setTool({
      kind: 'clone',
      source: { x: 3, y: 3 },
      offset: { x: 2, y: 2 },
    });

    useImageEditorStore.getState().closeEditor();
    useImageEditorStore.getState().openEditor(second);
    await settle();

    expect(useImageEditorStore.getState().tool).toEqual({
      kind: 'clone',
      source: null,
      offset: null,
    });
    expect(useImageEditorStore.getState().session?.dirtySinceApply).toBe(false);
    expect(useImageEditorStore.getState().session?.history.undoStack).toHaveLength(0);
  });

  it('retires clone coordinates on direct and stashed image switches', async () => {
    const first = raster('clone-first');
    const second = raster('clone-second');
    setCurrentImages(first, second);
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(4, 4));
    const source = { kind: 'clone', source: { x: 3, y: 3 }, offset: null } as const;
    useImageEditorStore.getState().openEditor(first);
    await settle();
    useImageEditorStore.getState().setTool(source);
    useImageEditorStore.getState().openEditor(first);
    expect(useImageEditorStore.getState().tool).toBe(source);

    useImageEditorStore.getState().openEditor(second);
    await settle();
    expect(useImageEditorStore.getState().tool).toEqual({
      kind: 'clone',
      source: null,
      offset: null,
    });
    useImageEditorStore.getState().setTool(source);
    useImageEditorStore.getState().openEditor(first);
    expect(useImageEditorStore.getState().session?.objectId).toBe(first.id);
    expect(useImageEditorStore.getState().tool).toEqual({
      kind: 'clone',
      source: null,
      offset: null,
    });
  });
});
