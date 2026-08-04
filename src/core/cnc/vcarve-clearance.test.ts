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

  it('moves the flat-core boundary outward by the engraving tip radius', () => {
    const clearingTool: CncTool = { ...CLEAR_TOOL, diameterMm: 0.2 };
    const point: CncTool = {
      id: 'point',
      name: '90 degree pointed engraver',
      kind: 'engraving',
      diameterMm: 2,
      tipAngleDeg: 90,
    };
    const flat: CncTool = { ...point, id: 'flat', tipDiameterMm: 0.4 };
    const toolpathsFor = (vBit: CncTool) =>
      vcarveClearanceToolpaths([SQUARE], {
        vBit,
        clearTool: clearingTool,
        maxDepthMm: 0.5,
        stepoverPercent: 40,
      });
    const minimumX = (paths: ReadonlyArray<Polyline>) =>
      Math.min(...paths.flatMap((path) => path.points.map((pointValue) => pointValue.x)));

    expect(minimumX(toolpathsFor(flat)) - minimumX(toolpathsFor(point))).toBeCloseTo(0.2, 3);
  });
});
