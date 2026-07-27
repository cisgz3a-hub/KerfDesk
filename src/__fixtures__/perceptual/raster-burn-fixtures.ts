// Perceptual test harness — compiled-and-emitted raster fixtures.
//
// Drives the real pipeline end to end so the fidelity tests measure the
// shipping path and not a reconstruction of it: a luma buffer becomes a
// RasterImage scene object, compileJob dithers and orients it into a
// RasterGroup, and grblStrategy emits the actual G-code text a controller
// would receive. Nothing here reimplements resampling, dithering, orientation
// or sweep planning — that is the whole point, since a harness that repeats
// the emitter's arithmetic can only confirm the emitter agrees with itself.
//
// Returned alongside the G-code are the three numbers the density instrument
// needs and must NOT guess: the group's machine bounds, the S value a fully
// black pixel earns, and the scan-line interval.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { compileJob, type RasterGroup } from '../../core/job';
import { grblStrategy } from '../../core/output';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { fullPowerS, type MachineRect } from './gcode-burn-density';

export type RasterFixtureInput = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
  // Scene-space millimetres. compileJob converts to machine coordinates via
  // the device origin; the fixture reports the result as `rect`.
  readonly sceneBounds: MachineRect;
  readonly ditherAlgorithm: DitherAlgorithm;
  readonly powerPercent?: number;
  // Requested scan lines per mm. Choose it so the machine pixel grid matches
  // the source grid exactly (linesPerMm × mm extent === source pixels), or the
  // compiler's nearest-neighbour resample adds an error the fidelity score
  // would wrongly attribute to the emitter. See core/raster/luma-resample.ts.
  readonly linesPerMm?: number;
  readonly rotationDeg?: number;
  readonly bidirectional?: boolean;
  readonly device?: DeviceProfile;
};

export type RasterFixture = {
  readonly gcode: string;
  readonly group: RasterGroup;
  readonly device: DeviceProfile;
  // Machine-mm rectangle the compiled raster occupies.
  readonly rect: MachineRect;
  // S emitted for a fully black pixel: round(power% / 100 × device.maxPowerS).
  readonly sMax: number;
  // Machine-mm between adjacent scan rows.
  readonly lineIntervalMm: number;
};

const DEFAULT_POWER_PERCENT = 40;
const DEFAULT_LINES_PER_MM = 1;
const WHITE_LUMA = 255;

export function compileRasterFixture(input: RasterFixtureInput): RasterFixture {
  const device = input.device ?? DEFAULT_DEVICE_PROFILE;
  const powerPercent = input.powerPercent ?? DEFAULT_POWER_PERCENT;
  const object: SceneObject = {
    kind: 'raster-image',
    id: 'raster-fidelity-fixture',
    source: 'fixture.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: input.width,
    pixelHeight: input.height,
    bounds: input.sceneBounds,
    transform: { ...IDENTITY_TRANSFORM, rotationDeg: input.rotationDeg ?? 0 },
    color: '#808080',
    dither: input.ditherAlgorithm,
    linesPerMm: input.linesPerMm ?? DEFAULT_LINES_PER_MM,
    lumaBase64: encodeLumaBase64(input.luma),
  } satisfies RasterImage;
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: input.ditherAlgorithm,
    linesPerMm: input.linesPerMm ?? DEFAULT_LINES_PER_MM,
    power: powerPercent,
    minPower: 0,
    imageBidirectional: input.bidirectional ?? true,
  };
  const job = compileJob({ objects: [object], layers: [layer] }, device);
  const group = job.groups.find((candidate) => candidate.kind === 'raster');
  if (group === undefined || group.kind !== 'raster') {
    throw new Error('compileRasterFixture: compileJob produced no raster group');
  }
  return {
    gcode: grblStrategy.emit(job, device),
    group,
    device,
    rect: group.bounds,
    sMax: fullPowerS(powerPercent, device.maxPowerS),
    lineIntervalMm: (group.bounds.maxY - group.bounds.minY) / group.pixelHeight,
  };
}

/** Uniform grey field. 0 = black (full burn), 255 = white (laser off). */
export function solidLuma(width: number, height: number, value: number): Uint8Array {
  const out = new Uint8Array(width * height);
  out.fill(value);
  return out;
}

/** Left-to-right ramp from black to white. The canonical power-modulation probe. */
export function horizontalRampLuma(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.round((x / Math.max(1, width - 1)) * WHITE_LUMA);
    }
  }
  return out;
}

/**
 * Top-to-bottom ramp from black to white. The horizontal ramp is invariant
 * under a Y flip, so it cannot see a raster-orientation regression; this one
 * pairs with it to cover tone modulation and Y placement at the same time.
 */
export function verticalRampLuma(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const value = Math.round((y / Math.max(1, height - 1)) * WHITE_LUMA);
    for (let x = 0; x < width; x += 1) out[y * width + x] = value;
  }
  return out;
}

/**
 * Black only in the top-left quadrant of the source grid. Asymmetric in both
 * axes, so mirroring, rotation and Y-flip regressions each move it somewhere
 * a correlation score can see.
 */
export function quadrantLuma(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  out.fill(WHITE_LUMA);
  for (let y = 0; y < Math.floor(height / 2); y += 1) {
    for (let x = 0; x < Math.floor(width / 2); x += 1) out[y * width + x] = 0;
  }
  return out;
}

/**
 * Transpose: source (row, col) becomes (col, row). A +90° object rotation maps
 * the source grid onto the machine grid this way, so the rotation truth can be
 * built from plain array arithmetic instead of re-deriving the inverse
 * transform the compiler uses — which is the thing under test.
 */
export function transposeLuma(luma: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(luma.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      out[col * height + row] = luma[row * width + col] ?? WHITE_LUMA;
    }
  }
  return out;
}

export function mirrorLumaX(luma: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(luma.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      out[row * width + col] = luma[row * width + (width - 1 - col)] ?? WHITE_LUMA;
    }
  }
  return out;
}

export function invertLuma(luma: Uint8Array): Uint8Array {
  return Uint8Array.from(luma, (value) => WHITE_LUMA - value);
}

function encodeLumaBase64(luma: Uint8Array): string {
  let binary = '';
  for (const byte of luma) binary += String.fromCharCode(byte);
  return btoa(binary);
}
