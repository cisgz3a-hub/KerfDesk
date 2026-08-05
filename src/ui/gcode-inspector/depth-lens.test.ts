import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';
import { buildDepthLensScale, DEPTH_RAMP_DEEP, DEPTH_RAMP_SHALLOW } from './depth-lens';

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
