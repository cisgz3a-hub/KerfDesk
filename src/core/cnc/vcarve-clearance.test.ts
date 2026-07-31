import { describe, expect, it } from 'vitest';
import type { CncTool, Polyline } from '../scene';
import { vcarveClearanceToolpaths } from './vcarve-clearance';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};

const CLEAR_TOOL: CncTool = {
  id: 'clear',
  name: '3 mm end mill',
  kind: 'end-mill',
  diameterMm: 3,
};

describe('vcarveClearanceToolpaths', () => {
  it('does not clear a partial job when the V-bit angle is absent or invalid', () => {
    for (const tipAngleDeg of [undefined, 0.5, 179.5, Number.NaN]) {
      const vBit: CncTool = {
        id: 'v-bit',
        name: 'invalid V-bit',
        kind: 'v-bit',
        diameterMm: 3,
        ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
      };
      expect(
        vcarveClearanceToolpaths([SQUARE], {
          vBit,
          clearTool: CLEAR_TOOL,
          maxDepthMm: 2,
          stepoverPercent: 40,
        }),
      ).toEqual([]);
    }
  });

  it('preserves legacy clearance output for a non-V-bit selection', () => {
    expect(
      vcarveClearanceToolpaths([SQUARE], {
        vBit: CLEAR_TOOL,
        clearTool: CLEAR_TOOL,
        maxDepthMm: 2,
        stepoverPercent: 40,
      }).length,
    ).toBeGreaterThan(0);
  });
});
