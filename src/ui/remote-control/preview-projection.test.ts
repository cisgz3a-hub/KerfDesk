import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, type SceneObject, type TextObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { useStore } from '../state/store';
import { workspacePreviewProjection, PREVIEW_BASE64_LIMIT } from './preview-projection';
import { PREVIEW_POINT_LIMIT, previewView, resolvePreviewGeometry } from './preview-geometry';
import { RemoteFault } from './fault';
import type { RemoteBounds, RemoteControlOptions } from './types';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const rectangle = () =>
  createRectangle({
    id: 'rectangle',
    color: '#000000',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
  });
let sharing: boolean;
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
};
let options: RemoteControlOptions;
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
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/png;base64,${PNG}`,
  );
  vi.stubGlobal('Path2D', undefined);
  seed([rectangle()]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function seed(objects: readonly SceneObject[], visible = true) {
  const state = useStore.getState();
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects,
        layers: [{ ...createLayer({ id: 'line', color: '#000000' }), visible }],
      },
    },
  });
}
const run = (signal?: AbortSignal) =>
  workspacePreviewProjection(useStore.getState(), options, signal);

describe('remote artwork rendering and disclosure fence', () => {
  it('is disabled by default, without reading or rendering artwork', async () => {
    delete (options as { canShareArtwork?: () => boolean }).canShareArtwork;
    expect(await run()).toMatchObject({ status: 'disabled' });
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
  });
  it('paints real rotated and mirrored paths instead of bounding boxes', async () => {
    const object = {
      ...rectangle(),
      transform: {
        ...rectangle().transform,
        x: 30,
        y: 40,
        rotationDeg: 90,
        scaleX: 2,
        mirrorY: true,
      },
    };
    seed([object]);
    const projection = await run();
    expect(projection).toMatchObject({
      status: 'ready',
      bounds: { xMm: 30, yMm: 40, widthMm: 20, heightMm: 20 },
      preview: { mimeType: 'image/png', widthPx: 768, heightPx: 768 },
    });
    const geometry = resolvePreviewGeometry(useStore.getState().project, 768);
    const view = previewView(geometry.extent, 768);
    expect(context.moveTo).toHaveBeenCalledWith(
      view.offsetX + 30 * view.scale,
      view.offsetY + 40 * view.scale,
    );
    expect(context.lineTo).toHaveBeenCalledWith(
      view.offsetX + 30 * view.scale,
      view.offsetY + 60 * view.scale,
    );
    expect(context.lineTo.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(context.stroke).toHaveBeenCalled();
    const viewport = projection.viewport as RemoteBounds;
    expect(viewport.widthMm).toBeCloseTo(768 / view.scale);
    expect(viewport.xMm).toBeCloseTo(-view.offsetX / view.scale);
    expect(viewport.yMm).toBeCloseTo(-view.offsetY / view.scale);
    const [pixelX, pixelY] = context.moveTo.mock.calls[0]! as [number, number];
    expect(viewport.xMm + (pixelX / 768) * viewport.widthMm).toBeCloseTo(30);
    expect(viewport.yMm + (pixelY / 768) * viewport.heightMm).toBeCloseTo(40);
  });
  it('renders canonical curved geometry and precomputed text outlines without fetching fonts', async () => {
    const circle = createEllipse({
      id: 'ellipse',
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10 },
    });
    const text: TextObject = {
      kind: 'text',
      id: 'text',
      content: 'A',
      fontKey: 'inter',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 10 },
      transform: { ...rectangle().transform, x: 20 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 10 },
                { x: 2.5, y: 0 },
                { x: 5, y: 10 },
                { x: 0, y: 10 },
              ],
            },
          ],
        },
      ],
    };
    seed([circle, text]);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await run()).toMatchObject({
      status: 'ready',
      bounds: { xMm: 0, yMm: 0, widthMm: 25, heightMm: 10 },
    });
    expect(context.lineTo.mock.calls.length).toBeGreaterThan(20);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves fill topology and current layer visibility', async () => {
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [createLayer({ id: 'fill', color: '#000000', mode: 'fill' })],
        },
      },
    });
    expect(await run()).toMatchObject({ status: 'ready' });
    expect(context.fill).toHaveBeenCalledWith('evenodd');
    seed([rectangle()], false);
    context.lineTo.mockClear();
    expect(await run()).toMatchObject({ status: 'ready' });
    expect(context.lineTo).not.toHaveBeenCalled();
  });
  it('returns a blank preview for an empty workspace, without invented bounds', async () => {
    seed([]);
    const result = await run();
    expect(result.status).toBe('ready');
    expect(result).not.toHaveProperty('bounds');
    expect(context.stroke).not.toHaveBeenCalled();
    const { bedWidth, bedHeight } = useStore.getState().project.device;
    const viewport = result.viewport as RemoteBounds;
    expect(viewport.widthMm).toBeGreaterThan(Math.max(bedWidth, bedHeight));
    expect(viewport.xMm + viewport.widthMm / 2).toBeCloseTo(bedWidth / 2);
    expect(viewport.yMm + viewport.heightMm / 2).toBeCloseTo(bedHeight / 2);
  });
  it('maps a blank preview to the actual rectangular profile bed in scene coordinates for any origin', async () => {
    seed([]);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          bedWidth: 431.75,
          bedHeight: 312.25,
          origin: 'rear-right',
        },
      },
    });
    const result = await run();
    const viewport = result.viewport as RemoteBounds;
    expect(result.status).toBe('ready');
    expect(viewport.xMm + viewport.widthMm / 2).toBeCloseTo(431.75 / 2);
    expect(viewport.yMm + viewport.heightMm / 2).toBeCloseTo(312.25 / 2);
    expect(viewport.widthMm).toBeCloseTo((431.75 * 768) / 736);
    expect(result).not.toHaveProperty('bounds');
  });
  it('does not invent a drawing bed when the empty profile geometry is malformed', async () => {
    seed([]);
    const state = useStore.getState();
    useStore.setState({
      project: { ...state.project, device: { ...state.project.device, bedWidth: NaN } },
    });
    const result = await run();
    expect(result.status).toBe('unavailable');
    expect(result).not.toHaveProperty('viewport');
  });
  it('discloses image placement frames without loading or returning their URL', async () => {
    seed([
      {
        ...rectangle(),
        kind: 'raster-image',
        dataUrl: 'https://private.example/image',
      } as unknown as SceneObject,
    ]);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await run();
    expect(result).toMatchObject({ status: 'ready' });
    expect(result.message).toContain('Partial design preview');
    expect(result.message).toContain('placement only');
    expect(JSON.stringify(result)).not.toContain('private.example');
    expect(fetcher).not.toHaveBeenCalled();
    expect(context.setLineDash).toHaveBeenCalledWith([6, 4]);
  });
  it('refuses text whose geometry is not ready', async () => {
    seed([
      {
        ...rectangle(),
        kind: 'text',
        content: 'Still loading',
        paths: [],
      } as unknown as TextObject,
    ]);
    expect(await run()).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('Text outlines'),
    });
  });
  it('refuses malformed coordinates before a canvas is painted', async () => {
    seed([{ ...rectangle(), transform: { ...rectangle().transform, x: NaN } }]);
    expect(await run()).toMatchObject({ status: 'unavailable' });
    expect(context.fillRect).not.toHaveBeenCalled();
  });
  it('bounds object count and raw geometry without sampling it away', async () => {
    seed(Array.from({ length: 201 }, (_, i) => ({ ...rectangle(), id: `art-${i}` })));
    expect(await run()).toMatchObject({ status: 'unavailable' });
    seed([
      {
        ...rectangle(),
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: false,
                points: Array.from({ length: PREVIEW_POINT_LIMIT + 1 }, (_, i) => ({
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
  it('reduces image resolution to keep the bounded complete artwork payload', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValueOnce(
      `data:image/png;base64,iVBORw0KGgo${'A'.repeat(PREVIEW_BASE64_LIMIT)}`,
    );
    const result = await run();
    expect(result).toMatchObject({
      status: 'ready',
      preview: { widthPx: 512, heightPx: 512 },
    });
    expect(context.stroke).toHaveBeenCalledTimes(2);
    const viewport = result.viewport as RemoteBounds;
    const [pixelX, pixelY] = context.moveTo.mock.calls.at(-1)! as [number, number];
    expect(viewport.widthMm).toBeCloseTo((20 * 512) / 480);
    expect(viewport.xMm + (pixelX / 512) * viewport.widthMm).toBeCloseTo(0);
    expect(viewport.yMm + (pixelY / 512) * viewport.heightMm).toBeCloseTo(0);
  });
  it('refuses a PNG that cannot fit even at the minimum size', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(
      `data:image/png;base64,iVBORw0KGgo${'A'.repeat(PREVIEW_BASE64_LIMIT)}`,
    );
    expect(await run()).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('too large'),
    });
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(4);
  });
  it('rejects unexpected encoding and unavailable canvas safely', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue(
      'data:image/jpeg;base64,not-a-png',
    );
    expect(await run()).toMatchObject({ status: 'unavailable' });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(await run()).toMatchObject({ status: 'unavailable' });
  });
  it('cancels before rendering and if cancelled while encoding', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run(controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(context.fillRect).not.toHaveBeenCalled();
    const later = new AbortController();
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      later.abort();
      return `data:image/png;base64,${PNG}`;
    });
    await expect(run(later.signal)).rejects.toBeInstanceOf(RemoteFault);
  });
  it('drops pixels if sharing is disabled while encoding', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      sharing = false;
      return `data:image/png;base64,${PNG}`;
    });
    const result = await run();
    expect(result.status).toBe('disabled');
    expect(result).not.toHaveProperty('preview');
    expect(result).not.toHaveProperty('viewport');
  });
  it('does not expose source paths, text or private project metadata alongside pixels', async () => {
    const state = useStore.getState();
    useStore.setState({
      savedName: 'C:/private/project.lf2',
      project: {
        ...state.project,
        notes: 'private-secret',
        scene: {
          ...state.project.scene,
          objects: [{ ...rectangle(), id: 'C:/private/source.svg' }],
        },
      },
    });
    const result = await run();
    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
