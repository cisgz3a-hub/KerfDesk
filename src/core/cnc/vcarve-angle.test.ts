import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { vcarveIncludedAngleDeg } from './vcarve-angle';

function tool(kind: CncTool['kind'], tipAngleDeg?: number): CncTool {
  return {
    id: 'tool',
    name: 'Test tool',
    kind,
    diameterMm: 3,
    ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
  };
}

describe('vcarveIncludedAngleDeg', () => {
  it.each([undefined, 0.5, 179.5, Number.NaN])(
    'rejects invalid geometry on an actual V-bit: %s',
    (angle) => expect(vcarveIncludedAngleDeg(tool('v-bit', angle))).toBeNull(),
  );

  it.each([
    [undefined, 60],
    [0.5, 60],
    [Number.POSITIVE_INFINITY, 60],
    [15, 15],
  ])('keeps one legacy non-V-bit angle rule for %s', (angle, expected) => {
    expect(vcarveIncludedAngleDeg(tool('end-mill', angle))).toBe(expected);
  });

  it.each([
    [1, 1],
    [179, 179],
    [0.5, 60],
    [179.5, 60],
    [Number.NaN, 60],
  ])('applies the shared included-angle contract to engraving tools: %s', (angle, expected) => {
    expect(vcarveIncludedAngleDeg(tool('engraving', angle))).toBe(expected);
  });
});
