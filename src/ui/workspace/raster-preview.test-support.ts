import { vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { compileJob } from '../../core/job';
import { drawRasterPreview, type RasterPreviewBuildScheduler } from './draw-raster-preview';

export class PreviewImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}
export type PreviewTestCanvas = { width: number; height: number; pixels?: PreviewImageData };
export function previewSink() {
  const built: PreviewTestCanvas[] = [],
    drawn: PreviewTestCanvas[] = [];
  vi.stubGlobal('ImageData', PreviewImageData);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw Error('Unexpected element ' + tag);
    const canvas: PreviewTestCanvas = { width: 0, height: 0 };
    built.push(canvas);
    return {
      ...canvas,
      get width() {
        return canvas.width;
      },
      set width(n: number) {
        canvas.width = n;
      },
      get height() {
        return canvas.height;
      },
      set height(n: number) {
        canvas.height = n;
      },
      getContext: () => ({
        putImageData: (pixels: PreviewImageData) => {
          canvas.pixels = pixels;
        },
      }),
      source: canvas,
    } as unknown as HTMLCanvasElement;
  });
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'drawImage'
          ? (canvas: { source: PreviewTestCanvas }) => {
              drawn.push(canvas.source);
            }
          : () => undefined,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return {
    built,
    drawn,
    draw: (
      p: Project,
      scheduleBuild: RasterPreviewBuildScheduler = immediate,
      ready?: () => void,
    ) =>
      drawRasterPreview(
        ctx,
        p,
        { scale: 1, offsetX: 0, offsetY: 0 },
        { scheduleBuild, ...(ready === undefined ? {} : { onRasterPreviewReady: ready }) },
      ),
  };
}
export const immediate: RasterPreviewBuildScheduler = (work) => {
  work();
  return () => undefined;
};
export function previewRaster(id = 'preview-override'): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'asymmetric.png',
    dataUrl: 'data:image/png;base64,' + id,
    pixelWidth: 8,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    // eslint-disable-next-line no-restricted-syntax -- Fixture scene-data colour, not UI chrome.
    color: '#808080',
    operationIds: ['image'],
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: btoa(
      String.fromCharCode(
        ...[
          0, 0, 0, 255, 64, 128, 192, 255, 0, 255, 0, 255, 128, 192, 255, 64, 0, 0, 0, 255, 255,
          255, 0, 0, 255, 255, 255, 255, 64, 0, 0, 255,
        ],
      ),
    ),
  };
}
export function previewLayer(patch: Partial<Layer> = {}): Layer {
  return {
    // eslint-disable-next-line no-restricted-syntax -- Fixture operation colour, not UI chrome.
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    linesPerMm: 1,
    power: 41,
    minPower: 0,
    ditherAlgorithm: 'threshold',
    ...patch,
  };
}
export function previewProject(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer> = [previewLayer()],
): Project {
  return { ...createProject(), scene: { objects, layers } };
}
export function normalizedCompiledPixels(project: Project): number[][] {
  return compileJob(project.scene, project.device)
    .groups.filter((g) => g.kind === 'raster')
    .map((g) => {
      const max = project.device.maxPowerS,
        pixels: number[] = [];
      for (let y = 0; y < g.pixelHeight; y++)
        for (let x = 0; x < g.pixelWidth; x++) {
          const s = g.sValues[y * g.pixelWidth + x] ?? 0;
          pixels.push(max > 0 ? 255 - Math.round((255 * s) / max) : 255);
        }
      return pixels;
    });
}
export function gray(canvas: PreviewTestCanvas): number[] {
  return Array.from(canvas.pixels?.data ?? []).filter((_n, i) => i % 4 === 0);
}
export function pagedPreviewRaster(id: string, lumaAssetId: string): RasterImage {
  return {
    ...previewRaster(id),
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId: lumaAssetId + '-source',
      lumaAssetId,
      sourceMimeType: 'image/png',
      sourceByteLength: 4,
      lumaByteLength: 32,
      naturalWidth: 8,
      naturalHeight: 4,
      sampledWidth: 8,
      sampledHeight: 4,
      thumbnail: {
        mimeType: 'image/bmp',
        dataUrl: 'data:image/bmp;base64,thumb',
        width: 8,
        height: 4,
      },
    },
  };
}
