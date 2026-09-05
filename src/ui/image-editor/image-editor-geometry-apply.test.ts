import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { createProject, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { commitCrop } from './editor-session';
import { commitImageSize } from './editor-session-resize';
import { useImageEditorStore } from './image-editor-store';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));

const ORIGINAL_BOUNDS = { minX: 10, minY: 20, maxX: 20, maxY: 30 };
const TRANSFORM = { ...IDENTITY_TRANSFORM, x: 7, y: 9, scaleX: 2, scaleY: 3 };
const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'image',
  source: 'fixture.png',
  dataUrl: 'data:image/png;base64,fixture',
  pixelWidth: 10,
  pixelHeight: 10,
  bounds: ORIGINAL_BOUNDS,
  transform: TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 1,
};

beforeEach(() => {
  resetStore();
  const project = createProject();
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [IMAGE] } },
    projectDocumentEpoch: 5,
  });
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
  vi.mocked(decodeRasterToBuffer).mockResolvedValue(createRgbaBuffer(10, 10));
  vi.mocked(bakeBufferToBitmapFields).mockImplementation(async (doc) => ({
    dataUrl: 'data:image/png;base64,edited',
    lumaBase64: btoa(String.fromCharCode(255).repeat(doc.width * doc.height)),
  }));
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('editor physical geometry Apply', () => {
  it('applies resized crop bounds and restores original bounds after Revert, preserving transform and project undo', async () => {
    useImageEditorStore.getState().openEditor(IMAGE);
    await settle();
    const opened = useImageEditorStore.getState().session;
    if (opened === null) throw new Error('Editor did not open');
    useImageEditorStore.setState({
      session: commitImageSize(commitCrop(opened, { x: 2, y: 2, width: 3, height: 3 }), 2, 2),
    });
    useImageEditorStore.getState().apply();
    await settle();
    const croppedBounds = { minX: 12, minY: 22, maxX: 15, maxY: 25 };
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      bounds: croppedBounds,
      transform: TRANSFORM,
      pixelWidth: 2,
      pixelHeight: 2,
    });
    useImageEditorStore.getState().revert();
    useImageEditorStore.getState().apply();
    await settle();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      bounds: ORIGINAL_BOUNDS,
      transform: TRANSFORM,
    });
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toMatchObject({
      bounds: croppedBounds,
      transform: TRANSFORM,
    });
  });
});
