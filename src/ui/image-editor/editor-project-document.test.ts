import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createSession, revertSession } from './editor-session';
import { addLayerAboveActive, compositeSession } from './editor-session-layers';
import { commitImageSize } from './editor-session-resize';
import {
  bakeProjectPhoto,
  captureProjectDocument,
  openProjectPhoto,
} from './editor-project-document';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';

vi.mock('./image-editor-decode', () => ({
  bakeBufferToBitmapFields: vi.fn(),
  decodeRasterToBuffer: vi.fn(),
}));
const bounds = { minX: 10, minY: 20, maxX: 12, maxY: 21 };
function layered() {
  let session = createSession('photo', 'photo.png', createRgbaBuffer(2, 1), bounds);
  session = addLayerAboveActive(session, 'ink');
  session.doc.data.set([11, 21, 31, 127, 33, 44, 55, 0]);
  return {
    ...session,
    layers: session.layers.map((layer) =>
      layer.id === 'ink'
        ? {
            ...layer,
            name: 'Ink detail',
            opacity: 0.6,
            blend: 'multiply' as const,
            isVisible: false,
          }
        : layer,
    ),
  };
}
function image(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    bounds,
    transform: IDENTITY_TRANSFORM,
    dataUrl: 'data:image/png;base64,AA==',
    pixelWidth: 2,
    pixelHeight: 1,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

beforeEach(() => vi.resetAllMocks());
describe('editable photo project documents', () => {
  it('restores layer pixels, hidden ink, metadata and active paint target without decoding flattened PNG', async () => {
    const original = layered();
    const document = captureProjectDocument(original);
    const reopened = await openProjectPhoto({
      ...image(),
      editorDocument: JSON.parse(JSON.stringify(document)),
    });
    expect(reopened.layers).toEqual(original.layers);
    expect(reopened.doc).toBe(reopened.layers[1]?.buffer);
    expect(reopened.doc).not.toBe(original.doc);
    expect(reopened.dirtySinceApply).toBe(false);
    expect(reopened.history.undoStack).toHaveLength(0);
    expect(decodeRasterToBuffer).not.toHaveBeenCalled();
    expect(compositeSession(reopened)).toEqual(compositeSession(original));
  });
  it('Revert restores the saved layers and rescales their original pixels after image resize', async () => {
    const original = layered();
    const reopened = await openProjectPhoto({
      ...image(),
      editorDocument: captureProjectDocument(original),
    });
    reopened.doc.data.fill(0);
    const resized = commitImageSize(reopened, 4, 2);
    const reverted = revertSession(resized);
    expect(reverted.layers).toHaveLength(2);
    expect(reverted.activeLayerId).toBe('ink');
    expect(reverted.doc.width).toBe(4);
    expect(reverted.doc.data.some((value) => value !== 0)).toBe(true);
    expect(reverted.layers[1]).toMatchObject({
      name: 'Ink detail',
      isVisible: false,
      opacity: 0.6,
      blend: 'multiply',
    });
  });
  it('captures layers before async encoding yields, with no references to mutable editor buffers', async () => {
    let finish!: (value: { dataUrl: string; lumaBase64: string }) => void;
    vi.mocked(bakeBufferToBitmapFields).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const session = layered();
    const pending = bakeProjectPhoto(session);
    session.doc.data.fill(99);
    finish({ dataUrl: 'png', lumaBase64: 'AA==' });
    const fields = await pending;
    const reopened = await openProjectPhoto({ ...image(), editorDocument: fields.editorDocument });
    expect([...reopened.doc.data]).toEqual([11, 21, 31, 127, 33, 44, 55, 0]);
  });
  it('opens older flattened projects through the existing image decoder', async () => {
    const pixels = createRgbaBuffer(2, 1);
    vi.mocked(decodeRasterToBuffer).mockResolvedValue(pixels);
    const reopened = await openProjectPhoto(image());
    expect(reopened.layers).toHaveLength(1);
    expect(reopened.doc).toBe(pixels);
  });
});
