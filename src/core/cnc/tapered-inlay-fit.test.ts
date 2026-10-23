import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncTool,
  type Polyline,
} from '../scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../scene/cnc-tapered-inlay';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { compiledInlayGroups } from './compile-cnc-operation-groups';
import { deepestCutPerMove, measureInlayPairFit } from './tapered-inlay-fit.test-support';

// CNC audit v1 F5-P2-1 (ADR-665): the plug was an opening of the design, so it lost convex
// corners and narrow parts that the pocket kept. These tests seat the emitted plug in the emitted
// pocket, and in the exact V-carved pocket, reading only the G-code of both pieces.
const INTENT = {
  ...DEFAULT_CNC_TAPERED_INLAY,
  pocketDepthMm: 0.7,
  engagementDepthMm: 0.5,
  glueGapMm: 0.2,
  surfaceClearanceMm: 0.3,
  fitClearanceMm: 0.05,
  plugBorderMm: 1.5,
};

function closed(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}
function rect(x: number, y: number, width: number, height: number): Polyline {
  return closed([
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ]);
}
function star(cx: number, cy: number, outer: number, inner: number): Polyline {
  return closed(
    Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = Math.PI / 2 + (index * Math.PI) / 5;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
    }),
  );
}
// Sharp convex and concave corners, a counter, star tips and a stroke narrower than the
// 0.68 mm the opening needed on a 60 degree bit.
const SOURCE = [
  rect(10, 10, 8, 8),
  rect(12.5, 12.5, 3, 3),
  star(24, 14, 4, 1.6),
  rect(30, 10, 0.5, 8),
];
const BOUNDS = { minX: 10, minY: 10, maxX: 30.5, maxY: 18 };
const DEPTH_PER_PASS_MM = 0.25;

type EmittedPair = { readonly pocket: string; readonly plug: string; readonly tool: CncTool };
const pairs = new Map<number, EmittedPair>();
function emittedPair(angle: number): EmittedPair {
  const cached = pairs.get(angle);
  if (cached !== undefined) return cached;
  const pair = compilePair(angle);
  pairs.set(angle, pair);
  return pair;
}
function compilePair(angle: number): EmittedPair {
  const tool: CncTool = {
    id: 'v',
    name: 'Pointed V',
    kind: 'v-bit',
    diameterMm: 6,
    tipAngleDeg: angle,
  };
  const settings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'inlay-pair' as const,
    toolId: tool.id,
    depthPerPassMm: DEPTH_PER_PASS_MM,
    vResolutionMm: 0.1,
    taperedInlay: INTENT,
  };
  const result = compiledInlayGroups(
    createLayer({ id: 'pair', color: '#000000' }),
    settings,
    SOURCE,
    DEFAULT_DEVICE_PROFILE,
    { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
  );
  const groups = result?.groups;
  if (groups === null || groups === undefined) throw new Error('Missing tapered pair');
  const emit = (group: typeof groups.female) =>
    cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
  return { pocket: emit(groups.female), plug: emit(groups.male), tool };
}

describe('tapered inlay pair seated from emitted G-code', () => {
  it.each([60, 90])(
    'seats the %s degree plug on every pocket wall, corner, counter and narrow stroke',
    (angle) => {
      const { pocket, plug, tool } = emittedPair(angle);
      const slope = Math.tan((angle * Math.PI) / 360);
      const fit = measureInlayPairFit({
        pocketProgram: pocket,
        plugProgram: plug,
        source: SOURCE,
        mirrorSumX: 2 * BOUNDS.maxX + INTENT.pairSpacingMm + INTENT.plugBorderMm,
        includedAngleDeg: angle,
        toolRadiusMm: tool.diameterMm / 2,
        pocketDepthMm: INTENT.pocketDepthMm,
        designedSeatMm: INTENT.engagementDepthMm + INTENT.fitClearanceMm / slope,
        gridMm: 0.025,
        // Inside the 1.5 mm plug border: the plug blank is cut off within its waste.
        marginMm: 1,
      });
      expect(fit.mirroredPlugCentreX).toBeCloseTo((BOUNDS.minX + BOUNDS.maxX) / 2, 2);
      // In the exact pocket the plug seats where designed and fills every detail. Before
      // ADR-665 the star tips and the 0.5 mm stroke stayed open and the plug sank too deep.
      expect(Math.abs(fit.exactPocket.interferenceAtDesignedSeatMm)).toBeLessThan(0.02);
      expect(fit.exactPocket.worstGapMm).toBeLessThan(0.05);
      expect(fit.exactPocket.interferenceAreaMm2).toBe(0);
      expect(fit.emitted.interferenceAreaMm2).toBe(0);
      // In the emitted pocket the plug stops short only by as much as the pocket is undercut
      // where it first touches (the flat-floor inside-corner fins of audit F5-P2-2, about
      // 0.07 mm here). Once those are cleared this bound closes the seam to the exact fit.
      expect(fit.emitted.interferenceAtDesignedSeatMm).toBeLessThan(
        fit.pocketShortfallAtContactMm + 0.02,
      );
    },
    120_000,
  );

  it.each([60, 90])(
    'cuts no deeper than the depth per pass in any %s degree move',
    (angle) => {
      const { pocket, plug, tool } = emittedPair(angle);
      const slope = Math.tan((angle * Math.PI) / 360);
      const radius = tool.diameterMm / 2;
      // Every plug level is one carve stepped down from the stock top (ADR-665), so the levels
      // share their routes and floor ridges.
      const plugFrame = { x0: 40, y0: 8, h: 0.05, nx: 500, ny: 240 };
      expect(deepestCutPerMove(plug, plugFrame, slope, radius)).toBeLessThan(
        DEPTH_PER_PASS_MM + 0.002,
      );
      // The pocket's V-carve compacts each level on its own, within its 0.01 mm sweep tolerance.
      const pocketFrame = { x0: 9.5, y0: 9.5, h: 0.05, nx: 440, ny: 180 };
      expect(deepestCutPerMove(pocket, pocketFrame, slope, radius)).toBeLessThan(
        DEPTH_PER_PASS_MM + 0.01 / slope,
      );
    },
    120_000,
  );
});
