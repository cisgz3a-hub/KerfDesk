import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { useStore } from '../state/store';
import { testAdapter, writeArgs } from './authoring-test-support';
import { PREVIEW_BASE64_LIMIT, workspacePreviewProjection } from './preview-projection';
import { PREVIEW_POINT_LIMIT, previewView, resolvePreviewGeometry } from './preview-geometry';
import type { RemoteBounds, RemoteControlOptions } from './types';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const vector = () =>
  createRectangle({
    id: 'vector',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
  });
const raster = (): RasterImage => ({
  kind: 'raster-image',
  id: 'image',
  source: 'private-image-name.png',
  dataUrl: 'https://private.example/source-image',
  pixelWidth: 200,
  pixelHeight: 100,
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 40, y: 30, rotationDeg: 90, scaleX: 2, mirrorX: true },
  color: '#808080',
  dither: 'grayscale',
  linesPerMm: 10,
});
let sharing: boolean;
let options: RemoteControlOptions;
let context: {
  fillRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  setLineDash: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  sharing = true;
  options = {
    canWrite: () => false,
    canShareArtwork: () => sharing,
    getAppStatus: () => ({
      app: { name: 'KerfDesk', version: '1', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    }),
  };
  context = {
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/png;base64,${PNG}`,
  );
  vi.stubGlobal('Path2D', undefined);
  seed([raster(), vector()]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function seed(objects: readonly SceneObject[], imageVisible = true) {
  const state = useStore.getState();
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects,
        layers: [
          createLayer({ id: 'line', color: '#000000' }),
          {
            ...createLayer({ id: 'image-operation', color: '#808080', mode: 'image' }),
            visible: imageVisible,
          },
        ],
      },
    },
  });
}
const run = (signal?: AbortSignal) =>
  workspacePreviewProjection(useStore.getState(), options, signal);

describe('partial image previews retain a truthful editable canvas', () => {
  it('renders vectors plus the actual rotated and mirrored image footprint', async () => {
    const result = await run();
    expect(result).toMatchObject({
      status: 'ready',
      message: expect.stringContaining('Image pixels, masks and adjustments remain on the PC'),
    });
    const bounds = result.bounds as RemoteBounds;
    expect(bounds.xMm).toBeCloseTo(0);
    expect(bounds.yMm).toBeCloseTo(-10);
    expect(bounds.widthMm).toBeCloseTo(40);
    expect(bounds.heightMm).toBeCloseTo(40);
    expect(context.setLineDash).toHaveBeenCalledWith([6, 4]);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.lineTo).toHaveBeenCalledTimes(8);
    expect(context.drawImage).not.toHaveBeenCalled();
    const geometry = resolvePreviewGeometry(useStore.getState().project, 768);
    expect(geometry.objects.map(({ object }) => object.id)).toEqual(['vector']);
    const actual = geometry.imageFootprints[0]!.corners;
    const expected = [
      { x: 40, y: 30 },
      { x: 40, y: -10 },
      { x: 30, y: -10 },
      { x: 30, y: 30 },
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i]!.x).toBeCloseTo(expected[i]!.x);
      expect(actual[i]!.y).toBeCloseTo(expected[i]!.y);
    }
    const viewport = result.viewport as RemoteBounds;
    const [xPx, yPx] = context.moveTo.mock.calls[0]! as [number, number];
    expect(viewport.xMm + (xPx / 768) * viewport.widthMm).toBeCloseTo(40);
    expect(viewport.yMm + (yPx / 768) * viewport.heightMm).toBeCloseTo(30);
    expect(context.restore.mock.invocationCallOrder[0]).toBeLessThan(
      context.stroke.mock.invocationCallOrder[1]!,
    );
  });
  it('never reads image sources, thumbnails, pixels, masks, private names or files', async () => {
    const image = raster();
    const privateRead = vi.fn(() => {
      throw new Error('private source accessed');
    });
    for (const key of ['dataUrl', 'imageAsset', 'lumaBase64', 'source', 'imageMaskId', 'imageClip'])
      Object.defineProperty(image, key, { get: privateRead });
    seed([image, vector()]);
    const fetcher = vi.fn();
    const decoder = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('createImageBitmap', decoder);
    const result = await run();
    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('dataUrl');
    expect(privateRead).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(decoder).not.toHaveBeenCalled();
  });
  it('keeps canonical rectangle creation, exact revision and replay admission in a mixed job', async () => {
    const originalImage = useStore.getState().project.scene.objects[0];
    const adapter = testAdapter({ canShareArtwork: () => sharing });
    try {
      const snapshot = await adapter.execute('get_workspace_preview', {});
      expect(snapshot).toMatchObject({
        ok: true,
        data: { status: 'ready', viewport: expect.any(Object) },
      });
      const args = writeArgs(adapter, { xMm: 5, yMm: 6, widthMm: 7, heightMm: 8 });
      const created = await adapter.execute('add_rectangle', args);
      expect(created.ok).toBe(true);
      expect(await adapter.execute('add_rectangle', args)).toEqual(created);
      expect(
        await adapter.execute('add_rectangle', { ...args, requestId: crypto.randomUUID() }),
      ).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
      expect(useStore.getState().project.scene.objects).toHaveLength(3);
      expect(useStore.getState().project.scene.objects[0]).toBe(originalImage);
      const createdObject = useStore.getState().project.scene.objects.at(-1)!;
      expect(createdObject.bounds).toEqual({ minX: 0, minY: 0, maxX: 7, maxY: 8 });
      expect(createdObject.transform.x).toBe(5);
      expect(createdObject.transform.y).toBe(6);
      expect(await adapter.execute('get_workspace_preview', {})).toMatchObject({
        ok: true,
        data: { status: 'ready', message: expect.stringContaining('Partial design preview') },
      });
    } finally {
      adapter.dispose();
    }
  });
  it('supports an image-only scene and hides image footprints with their operation', async () => {
    seed([raster()]);
    expect(await run()).toMatchObject({ status: 'ready', bounds: expect.any(Object) });
    expect(context.stroke).toHaveBeenCalledTimes(1);
    seed([raster(), vector()], false);
    context.stroke.mockClear();
    context.setLineDash.mockClear();
    expect(await run()).toMatchObject({
      status: 'ready',
      bounds: { xMm: 0, yMm: 0, widthMm: 10, heightMm: 20 },
    });
    expect(context.stroke).toHaveBeenCalledTimes(1);
    expect(context.setLineDash).not.toHaveBeenCalled();
  });
  it.each(['nonfinite', 'inverted', 'transformed'] as const)(
    'refuses %s image placement without painting or touching image sources',
    async (fault) => {
      const image = raster();
      const invalid =
        fault === 'nonfinite'
          ? { ...image, bounds: { ...image.bounds, minX: NaN } }
          : fault === 'inverted'
            ? { ...image, bounds: { ...image.bounds, minX: 21 } }
            : { ...image, transform: { ...image.transform, scaleX: 100_000 } };
      seed([invalid, vector()]);
      expect(await run()).toMatchObject({ status: 'unavailable' });
      expect(context.fillRect).not.toHaveBeenCalled();
    },
  );
  it('retains the complete composition and exact mapping at the bounded fallback size', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValueOnce(
      `data:image/png;base64,iVBORw0KGgo${'A'.repeat(PREVIEW_BASE64_LIMIT)}`,
    );
    const result = await run();
    expect(result).toMatchObject({ status: 'ready', preview: { widthPx: 512, heightPx: 512 } });
    expect(context.stroke).toHaveBeenCalledTimes(4);
    const geometry = resolvePreviewGeometry(useStore.getState().project, 512);
    const view = previewView(geometry.extent, 512);
    const viewport = result.viewport as RemoteBounds;
    expect(viewport.widthMm).toBeCloseTo(512 / view.scale);
    expect(viewport.xMm + ((view.offsetX + 40 * view.scale) / 512) * viewport.widthMm).toBeCloseTo(
      40,
    );
  });
  it('counts image footprint corners within the existing geometry budget', async () => {
    seed([
      raster(),
      {
        ...vector(),
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: false,
                points: Array.from({ length: PREVIEW_POINT_LIMIT - 3 }, (_, i) => ({
                  x: i % 10,
                  y: i % 20,
                })),
              },
            ],
          },
        ],
      },
    ]);
    expect(await run()).toMatchObject({ status: 'unavailable' });
    expect(context.fillRect).not.toHaveBeenCalled();
  });
  it('keeps source limits, cancellation and artwork-sharing opt-out intact for partial previews', async () => {
    seed(Array.from({ length: 201 }, (_, i) => ({ ...raster(), id: `raster-${i}` })));
    expect(await run()).toMatchObject({ status: 'unavailable' });
    expect(context.fillRect).not.toHaveBeenCalled();
    seed([raster(), vector()]);
    const controller = new AbortController();
    controller.abort();
    await expect(run(controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    sharing = false;
    expect(await run()).toMatchObject({ status: 'disabled' });
    expect(context.fillRect).not.toHaveBeenCalled();
    sharing = true;
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      sharing = false;
      return `data:image/png;base64,${PNG}`;
    });
    const result = await run();
    expect(result.status).toBe('disabled');
    expect(result).not.toHaveProperty('preview');
    expect(result).not.toHaveProperty('viewport');
    expect(result).not.toHaveProperty('bounds');
  });
});
