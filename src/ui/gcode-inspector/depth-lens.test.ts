import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import { buildDepthLensScale, DEPTH_RAMP_DEEP, DEPTH_RAMP_SHALLOW } from './depth-lens';

const DEPTH_PROPERTY_RUNS = 100;
const DEPTH_PROPERTY_SEED = 2_026_080_5;

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
  it('maps ordered depth passes to ordered nearby shades', () => {
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

  it('preserves range and ordered-colour invariants across generated passes', () => {
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
            deeper.forEach((channel, channelIndex) =>
              expect(channel).toBeLessThan(shallower[channelIndex] ?? channel + 1),
            );
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

function expectRgbClose(
  actual: ReadonlyArray<number> | undefined,
  expected: ReadonlyArray<number>,
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((channel, index) => expect(actual?.[index]).toBeCloseTo(channel, 10));
}
