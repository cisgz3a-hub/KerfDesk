import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import { resolveViewer3dTheme } from '../viewer3d';
import { buildDepthLensScale, DEPTH_RAMP_DEEP, DEPTH_RAMP_SHALLOW, type Rgb } from './depth-lens';

const DEPTH_PROPERTY_RUNS = 100;
const DEPTH_PROPERTY_SEED = 2_026_080_5;
const MAX_MUTED_RED_DOMINANCE = 0.35;
const MIN_MUTED_RED_LUMINANCE = 0.2;
const MIN_VIEWER_CONTRAST_RATIO = 4.5;
const CONTRAST_LUMINANCE_OFFSET = 0.05;
const SRGB_LINEAR_THRESHOLD = 0.04045;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_EXPONENT = 2.4;
const LUMINANCE_RED_WEIGHT = 0.2126;
const LUMINANCE_GREEN_WEIGHT = 0.7152;
const LUMINANCE_BLUE_WEIGHT = 0.0722;
const RGB_RED_SHIFT = 16;
const RGB_GREEN_SHIFT = 8;
const RGB_CHANNEL_MASK = 0xff;
const RGB_CHANNEL_SCALE = 255;
const VIEWER_BACKGROUND = rgbChannels(resolveViewer3dTheme(null).background);

const THREE_PASS_PROGRAM = [
  'G21 G90',
  'G0 Z5',
  'G0 X0 Y0',
  'G1 Z-1 F200',
  'G1 X10 F600',
  'G0 Z5',
  'G0 X20',
  'G1 Z-2 F200',
  'G1 X30 F600',
  'G0 Z5',
  'G0 X40',
  'G1 Z-3 F200',
  'G1 X50 F600',
  'G0 Z5',
].join('\n');

describe('buildDepthLensScale', () => {
  it('maps ordered depth passes from light blue through a balanced tone to muted red', () => {
    const model = renderModel(THREE_PASS_PROGRAM);
    const scale = buildDepthLensScale(model);
    expect(scale).not.toBeNull();
    expect(scale?.shallowMm).toBe(-1);
    expect(scale?.deepMm).toBe(-3);
    expect(scale?.levelCount).toBe(3);

    const cuts = cutIndices(model);
    const shallow = scale?.colorOf(cuts[0] ?? -1);
    const middle = scale?.colorOf(cuts[1] ?? -1);
    const deep = scale?.colorOf(cuts[2] ?? -1);
    expectRgbClose(shallow, DEPTH_RAMP_SHALLOW);
    expectRgbClose(deep, DEPTH_RAMP_DEEP);
    expectRgbClose(
      middle,
      DEPTH_RAMP_SHALLOW.map((channel, index) =>
        channelMidpoint(channel, DEPTH_RAMP_DEEP[index] ?? channel),
      ),
    );
  });

  it('keeps the muted red endpoint readable without making it overwhelming', () => {
    const [red, green, blue] = DEPTH_RAMP_DEEP;
    expect(red).toBeGreaterThan(green);
    expect(red).toBeGreaterThan(blue);
    expect(red - Math.max(green, blue)).toBeLessThan(MAX_MUTED_RED_DOMINANCE);
    expect(relativeLuminance(DEPTH_RAMP_DEEP)).toBeGreaterThan(MIN_MUTED_RED_LUMINANCE);

    const middle = DEPTH_RAMP_SHALLOW.map((channel, index) =>
      channelMidpoint(channel, DEPTH_RAMP_DEEP[index] ?? channel),
    );
    for (const color of [DEPTH_RAMP_SHALLOW, middle, DEPTH_RAMP_DEEP]) {
      expect(contrastRatio(color, VIEWER_BACKGROUND)).toBeGreaterThanOrEqual(
        MIN_VIEWER_CONTRAST_RATIO,
      );
    }
  });

  it('excludes safe-height traversal from the depth range', () => {
    const scale = buildDepthLensScale(renderModel(THREE_PASS_PROGRAM));
    expect(scale?.shallowMm).toBe(-1);
    expect(scale?.deepMm).toBe(-3);
  });

  it('includes both endpoints of a variable-depth cutting move', () => {
    const model = renderModel(['G21 G90', 'G0 Z5', 'G1 Z-1 F200', 'G1 X10 Z-3 F600'].join('\n'));
    const scale = buildDepthLensScale(model);
    expect(scale?.shallowMm).toBe(-1);
    expect(scale?.deepMm).toBe(-3);
  });

  it('merges cutting and plunge depths into one machining range', () => {
    const model = renderModel(
      [
        'G21 G90',
        'G0 Z5',
        'G1 Z-1 F200',
        'G1 X10 F600',
        'G0 Z5',
        'G0 X20',
        'G1 Z-3 F200',
        'G0 Z5',
      ].join('\n'),
    );
    const scale = buildDepthLensScale(model);
    expect(scale?.shallowMm).toBe(-1);
    expect(scale?.deepMm).toBe(-3);

    const deepPlunge = [...model.segKind].findIndex(
      (kind, index) => kind === SEG_KIND.plunge && model.positions[index * 6 + 5] === -3,
    );
    expect(deepPlunge).toBeGreaterThanOrEqual(0);
    expectRgbClose(scale?.colorOf(deepPlunge), DEPTH_RAMP_DEEP);
  });

  it('preserves range and ordered warm-colour invariants across generated passes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 120 }), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 2, max: 20 }),
        (rawDepthUnits, extraDepthUnits, safeHeightMm) => {
          const depthUnits = [...rawDepthUnits].sort((left, right) => left - right);
          const deepestPlungeUnits = (depthUnits.at(-1) ?? 0) + extraDepthUnits;
          const model = renderModel(
            generatedPassProgram(depthUnits, deepestPlungeUnits, safeHeightMm),
          );
          const scale = buildDepthLensScale(model);
          expect(scale).not.toBeNull();
          if (scale === null) return;

          expect(scale.shallowMm).toBeCloseTo(-(depthUnits[0] ?? 0) / 10, 6);
          expect(scale.deepMm).toBeCloseTo(-deepestPlungeUnits / 10, 6);
          expect(scale.levelCount).toBe(depthUnits.length + 1);

          const orderedCuts = [...cutIndices(model)].sort(
            (left, right) => segmentEndZ(model, right) - segmentEndZ(model, left),
          );
          for (let index = 1; index < orderedCuts.length; index += 1) {
            const shallower = scale.colorOf(orderedCuts[index - 1] ?? -1);
            const deeper = scale.colorOf(orderedCuts[index] ?? -1);
            expect(deeper[0]).toBeGreaterThan(shallower[0]);
            expect(deeper[1]).toBeLessThan(shallower[1]);
            expect(deeper[2]).toBeLessThan(shallower[2]);
            expect(relativeLuminance(deeper)).toBeLessThan(relativeLuminance(shallower));
          }

          const deepestPlunge = [...model.segKind]
            .map((kind, index) => ({ kind, index }))
            .filter(({ kind }) => kind === SEG_KIND.plunge)
            .map(({ index }) => index)
            .sort((left, right) => segmentEndZ(model, left) - segmentEndZ(model, right))[0];
          expect(deepestPlunge).toBeDefined();
          expectRgbClose(scale.colorOf(deepestPlunge ?? -1), DEPTH_RAMP_DEEP);
        },
      ),
      { numRuns: DEPTH_PROPERTY_RUNS, seed: DEPTH_PROPERTY_SEED },
    );
  });

  it('is deterministic for the same program', () => {
    const model = renderModel(THREE_PASS_PROGRAM);
    const first = buildDepthLensScale(model);
    const second = buildDepthLensScale(model);
    const cuts = cutIndices(model);
    expect(cuts.map((index) => first?.colorOf(index))).toEqual(
      cuts.map((index) => second?.colorOf(index)),
    );
  });
});

function renderModel(program: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(program);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function cutIndices(model: GcodeRenderModel): ReadonlyArray<number> {
  return [...model.segKind]
    .map((kind, index) => ({ kind, index }))
    .filter(({ kind }) => kind === SEG_KIND.cut)
    .map(({ index }) => index);
}

function generatedPassProgram(
  depthUnits: ReadonlyArray<number>,
  deepestPlungeUnits: number,
  safeHeightMm: number,
): string {
  const lines = ['G21 G90', `G0 Z${safeHeightMm}`];
  depthUnits.forEach((units, index) => {
    const startX = index * 20;
    lines.push(
      `G0 X${startX}`,
      `G1 Z${(-units / 10).toFixed(1)} F200`,
      `G1 X${startX + 10} F600`,
      `G0 Z${safeHeightMm}`,
    );
  });
  lines.push(
    `G0 X${depthUnits.length * 20}`,
    `G1 Z${(-deepestPlungeUnits / 10).toFixed(1)} F200`,
    `G0 Z${safeHeightMm}`,
  );
  return lines.join('\n');
}

function segmentEndZ(model: GcodeRenderModel, index: number): number {
  return model.positions[index * 6 + 5] ?? 0;
}

function channelMidpoint(shallow: number, deep: number): number {
  return shallow + (deep - shallow) * 0.5;
}

function contrastRatio(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  const brighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (brighter + CONTRAST_LUMINANCE_OFFSET) / (darker + CONTRAST_LUMINANCE_OFFSET);
}

function relativeLuminance(rgb: ReadonlyArray<number>): number {
  const linear = (channel: number): number =>
    channel <= SRGB_LINEAR_THRESHOLD
      ? channel / SRGB_LINEAR_DIVISOR
      : ((channel + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_EXPONENT;
  return (
    LUMINANCE_RED_WEIGHT * linear(rgb[0] ?? 0) +
    LUMINANCE_GREEN_WEIGHT * linear(rgb[1] ?? 0) +
    LUMINANCE_BLUE_WEIGHT * linear(rgb[2] ?? 0)
  );
}

function rgbChannels(color: number): Rgb {
  return [
    ((color >> RGB_RED_SHIFT) & RGB_CHANNEL_MASK) / RGB_CHANNEL_SCALE,
    ((color >> RGB_GREEN_SHIFT) & RGB_CHANNEL_MASK) / RGB_CHANNEL_SCALE,
    (color & RGB_CHANNEL_MASK) / RGB_CHANNEL_SCALE,
  ];
}

function expectRgbClose(
  actual: ReadonlyArray<number> | undefined,
  expected: ReadonlyArray<number>,
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((channel, index) => expect(actual?.[index]).toBeCloseTo(channel, 10));
}
