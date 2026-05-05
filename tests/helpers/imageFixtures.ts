/**
 * T2-20: programmatic raster image fixtures for the
 * image → JobCompiler → PlanOptimizer → Output pipeline.
 *
 * Pre-T2-20 nothing exercised the full pipeline with pixel-level
 * expected G-code. Image-processing tests stopped at pixel arrays;
 * planner tests used synthetic moves; the two layers were tested
 * independently but never connected. A bug in raster scanline
 * coordinate calculation (T1-31 raster strategy fix, or any future
 * raster change) could ship with passing image-processing tests
 * AND passing E2E snapshot tests while pixel-level output was
 * wrong.
 *
 * Each fixture builds a SceneObject + parent Scene with a known
 * grayscale buffer + dimensions. Companion analyzer assertions
 * (T2-19) verify burn bounds, scanline count, S-values per
 * segment, physical dimensions.
 *
 * Lives under `tests/helpers/` so the auto-discovery runner's
 * EXCLUDED_DIRS (T2-22) skips it as a non-test file.
 */

import { createScene } from '../../src/core/scene/Scene';
import { createLayer } from '../../src/core/scene/Layer';
import {
  type ImageGeometry,
  type SceneObject,
} from '../../src/core/scene/SceneObject';
import { IDENTITY_MATRIX, generateId } from '../../src/core/types';

export interface RasterFixture {
  scene: ReturnType<typeof createScene>;
  /** Width / height in pixels (== bitmap dimensions). */
  width: number;
  height: number;
  /** Grayscale data the fixture seeded; useful for cross-checks. */
  data: Uint8Array;
  /** Layer ID of the image layer. */
  layerId: string;
  /** Image object ID. */
  objectId: string;
  /** Fixture label for assertion messages. */
  label: string;
}

/**
 * Threshold imageMode treats `pixel < threshold` (default 128) as
 * burn (255), pixel ≥ threshold as blank (0). Generators that want
 * "burn" cells write 0; "blank" cells default to 255.
 */
function makeFixture(opts: {
  label: string;
  width: number;
  height: number;
  data: Uint8Array;
  /** Default 'threshold' for predictable 1-bit output; pass
   *  'grayscale' for variable-S tests. */
  imageMode?: 'threshold' | 'grayscale' | 'dither';
  threshold?: number;
  power?: { min: number; max: number };
  speed?: number;
  /** Position the image on the bed in mm. */
  pos?: { x: number; y: number };
}): RasterFixture {
  const { label, width, height, data } = opts;
  const scene = createScene(400, 300, label);
  const layer = createLayer(0, 'image', `${label}-layer`);
  layer.settings.speed = opts.speed ?? 6000;
  layer.settings.power = opts.power ?? { min: 20, max: 80 };
  layer.settings.image.imageMode = opts.imageMode ?? 'threshold';
  layer.settings.image.imageThreshold = opts.threshold ?? 128;
  scene.layers = [layer];
  scene.activeLayerId = layer.id;

  const geom: ImageGeometry = {
    type: 'image',
    src: 'data:image/png;base64,xx',
    originalWidth: width,
    originalHeight: height,
    cropX: 0, cropY: 0, cropWidth: width, cropHeight: height,
    grayscaleData: data,
    grayscaleWidth: width,
    grayscaleHeight: height,
  };
  const objectId = generateId();
  const obj: SceneObject = {
    id: objectId,
    type: 'image',
    name: label,
    layerId: layer.id,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: opts.pos?.x ?? 50, ty: opts.pos?.y ?? 50 },
    geometry: geom,
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
  scene.objects = [obj];

  return { scene, width, height, data, layerId: layer.id, objectId, label };
}

export function blackPixel(): RasterFixture {
  return makeFixture({
    label: 'black-pixel',
    width: 1, height: 1,
    data: new Uint8Array([0]),
  });
}

export function whitePixel(): RasterFixture {
  return makeFixture({
    label: 'white-pixel',
    width: 1, height: 1,
    data: new Uint8Array([255]),
  });
}

export function checkerboard(size: number): RasterFixture {
  const data = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // (r+c) even = burn (0); odd = blank (255)
      data[r * size + c] = ((r + c) & 1) === 0 ? 0 : 255;
    }
  }
  return makeFixture({
    label: `checkerboard-${size}`,
    width: size, height: size,
    data,
  });
}

export function horizontalGradient(width: number, height: number): RasterFixture {
  // Left = black (0), right = white (255). Each row identical.
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      data[r * width + c] = Math.round((c / Math.max(1, width - 1)) * 255);
    }
  }
  return makeFixture({
    label: `horizontal-gradient-${width}x${height}`,
    width, height, data,
    imageMode: 'grayscale',
  });
}

export function verticalGradient(width: number, height: number): RasterFixture {
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      data[r * width + c] = Math.round((r / Math.max(1, height - 1)) * 255);
    }
  }
  return makeFixture({
    label: `vertical-gradient-${width}x${height}`,
    width, height, data,
    imageMode: 'grayscale',
  });
}

/** All-blank-row at the given index in an otherwise all-burn image. */
export function blankRow(width: number, height: number, blankRowIndex: number): RasterFixture {
  const data = new Uint8Array(width * height);
  // All burn (0)
  for (let i = 0; i < data.length; i++) data[i] = 0;
  // Blank the chosen row
  for (let c = 0; c < width; c++) data[blankRowIndex * width + c] = 255;
  return makeFixture({
    label: `blank-row-${blankRowIndex}-of-${height}`,
    width, height, data,
  });
}

/** All-burn row at the given index, surrounded by blank rows. */
export function blackRow(width: number, height: number, burnRowIndex: number): RasterFixture {
  const data = new Uint8Array(width * height).fill(255);
  for (let c = 0; c < width; c++) data[burnRowIndex * width + c] = 0;
  return makeFixture({
    label: `black-row-${burnRowIndex}-of-${height}`,
    width, height, data,
  });
}

/** Diagonal stroke (top-left to bottom-right), 1-pixel thick. */
export function diagonalLine(size: number): RasterFixture {
  const data = new Uint8Array(size * size).fill(255);
  for (let i = 0; i < size; i++) data[i * size + i] = 0;
  return makeFixture({
    label: `diagonal-line-${size}`,
    width: size, height: size, data,
  });
}
