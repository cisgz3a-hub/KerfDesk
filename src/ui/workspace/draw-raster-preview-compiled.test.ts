import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { compiledRasterPreview } from './compiled-raster-preview';
import { drawRasterPreview } from './draw-raster-preview';

describe('drawRasterPreview compiled-grid parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const [label, transform] of [
    ['90-degree rotation plus horizontal mirror', { rotationDeg: 90, mirrorX: true }],
    ['asymmetric rotation plus vertical mirror', { rotationDeg: 30, mirrorY: true }],
  ] as const) {
    it(`paints the exact compiled S-grid for ${label}`, () => {
      let painted: FakeImageData | undefined;
      vi.stubGlobal('ImageData', FakeImageData);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}.`);
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            putImageData: vi.fn((imageData: FakeImageData) => {
              painted = imageData;
            }),
          }),
        } as unknown as HTMLCanvasElement;
      });
      const layer = {
        ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
        ditherAlgorithm: 'grayscale' as const,
        linesPerMm: 1,
      };
      const raster = asymmetricRaster(transform);
      const project: Project = {
        ...createProject(),
        scene: { objects: [raster], layers: [layer] },
      };
      const group = compileRasterGroupsForLayer([raster], layer, project.device).groups[0];
      if (group === undefined) throw new Error('Expected compiled raster group.');
      const expected = compiledRasterPreview(group, project.device);

      drawRasterPreview(
        noOpContext(),
        project,
        { scale: 1, offsetX: 0, offsetY: 0 },
        {
          scheduleBuild: runImmediately,
        },
      );

      expect(painted?.width).toBe(expected.width);
      expect(painted?.height).toBe(expected.height);
      expect(painted?.data).toEqual(expected.rgba);
    });
  }

  it('renders object-local image and negative overrides over a non-image base operation', () => {
    const captures: number[][] = [];
    vi.stubGlobal('ImageData', FakeImageData);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'canvas') throw new Error(`Unexpected element ${tag}.`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData: vi.fn((imageData: FakeImageData) => {
            captures.push(Array.from(imageData.data));
          }),
        }),
      } as unknown as HTMLCanvasElement;
    });
    const baseLayer = createLayer({ id: 'image', color: '#808080', mode: 'line' });
    const raster: RasterImage = {
      ...asymmetricRaster({ rotationDeg: 0 }),
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      lumaBase64: 'AP8=',
      operationOverride: {
        mode: 'image',
        ditherAlgorithm: 'threshold',
        linesPerMm: 1,
        negativeImage: false,
      },
    };
    const project = (object: RasterImage): Project => ({
      ...createProject(),
      scene: { objects: [object], layers: [baseLayer] },
    });
    const draw = (object: RasterImage): void => {
      drawRasterPreview(
        noOpContext(),
        project(object),
        { scale: 1, offsetX: 0, offsetY: 0 },
        {
          scheduleBuild: runImmediately,
        },
      );
    };

    draw(raster);
    draw({
      ...raster,
      operationOverride: { ...raster.operationOverride, negativeImage: true },
    });

    expect(captures).toHaveLength(2);
    expect(captures[0]).not.toEqual(captures[1]);
  });
});

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

function asymmetricRaster(transform: {
  readonly rotationDeg: number;
  readonly mirrorX?: boolean;
  readonly mirrorY?: boolean;
}): RasterImage {
  return {
    kind: 'raster-image',
    id: `asymmetric-${transform.rotationDeg}`,
    source: 'asymmetric.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 1, minY: 4, maxX: 7, maxY: 8 },
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64: btoa(String.fromCharCode(0, 48, 255, 192, 96, 16)),
  };
}

function noOpContext(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get() {
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

function runImmediately(work: () => void): () => void {
  work();
  return () => undefined;
}
