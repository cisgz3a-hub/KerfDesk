// ADR-258 Amendment 7 (CNC audit v3 N7, verifying #1889), measured from the
// EMITTED program:
// - N7-P1-2: an outline that stops just over one cut width short was cut with
//   no tabs and no warning, held only by the sliver across its gap (0.025 mm
//   at 3.2 mm on the 1/8" bit). It is now tabbed like a closed shape while
//   that sliver holds less than one tab.
// - N7-P3-1: small holes were said to hold "by as little as 0 mm" where the
//   program leaves a 3.0-3.7 mm neck. The bridge measure no longer walks into
//   the next window or round to the window's own kerf.

import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  BIT,
  TAB_TOP,
  art,
  circle,
  compiled,
  machineBox,
  rectangle,
} from './compile-cnc-tab-holds.test-support';
import { throughCut, type FeedSegment } from './tab-bridge-measure.test-support';

// An 80 x 60 outline drawn from its bottom-left corner, stopping `gapMm` short
// of where it began.
function openOutline(gapMm: number): Polyline {
  return {
    closed: false,
    points: [
      { x: 50 + gapMm, y: 50 },
      { x: 130, y: 50 },
      { x: 130, y: 110 },
      { x: 50, y: 110 },
      { x: 50, y: 50 },
    ],
  };
}

// Tab walls climbed from the full depth: one per tab on the deepest level.
function wallsFromFloor(segments: ReadonlyArray<FeedSegment>): number {
  return segments.filter(
    ({ a, b }) => a.x === b.x && a.y === b.y && Math.abs(a.z + 6.35) < 1e-6 && b.z > a.z,
  ).length;
}

describe('N7-P1-2: an outline just over one cut width short is held by tabs', () => {
  it.each([
    { cutType: 'profile-on-path' as const, gapMm: 3.2 },
    { cutType: 'profile-on-path' as const, gapMm: 3.3 },
    { cutType: 'profile-on-path' as const, gapMm: 3.6 },
    { cutType: 'profile-on-path' as const, gapMm: 4.5 },
    { cutType: 'profile-outside' as const, gapMm: 3.3 },
  ])('tabs the part cut $cutType with a $gapMm mm gap', ({ cutType, gapMm }) => {
    const { job, segments } = compiled([art([openOutline(gapMm)])], { cutType });

    // Main: no tab at all, the part held by a gap - 3.175 mm sliver alone.
    expect(wallsFromFloor(segments)).toBe(4);
    // All four tabs stand on the cut, none on the uncut gap: the through cut
    // falls into five pieces, the four tabs and the sliver between them.
    const cut = throughCut(segments, TAB_TOP, BIT, machineBox(50, 50, 80, 60));
    expect(cut.pieces).toBe(5);
    // The narrowest gap between pieces is that sliver: no tab is thinner.
    expect(cut.narrowestBridgeMm).toBeCloseTo(gapMm - BIT, 6);
    expect(job.cncCompilation?.tabHoldShapes?.map((shape) => shape.kind)).toContain('closed-gap');
  });

  it('tabs the quarter-inch bit at a 6.36 mm gap', () => {
    const { segments } = compiled([art([openOutline(6.36)])], {
      cutType: 'profile-on-path',
      toolId: 'em-6350',
    });

    expect(wallsFromFloor(segments)).toBe(4);
  });

  it('leaves an outline whose sliver holds more than a tab untabbed (ADR-258 Amendment 4)', () => {
    // 6 - 3.175 = 2.8 mm across 6.35 mm deep is 18 mm² of wall; a 6 x 2 mm tab is 12.
    const { job, segments } = compiled([art([openOutline(6)])], { cutType: 'profile-on-path' });

    expect(wallsFromFloor(segments)).toBe(0);
    expect(job.cncCompilation?.tabHoldShapes).toBeUndefined();
  });
});

describe('N7-P3-1: small holes are not said to hold by nothing', () => {
  function hexagon(cx: number, cy: number, acrossCornersMm: number): Polyline {
    return {
      closed: true,
      points: Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2;
        const r = acrossCornersMm / 2;
        return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      }),
    };
  }

  it('names no narrow bridge on 8-10 mm holes, an 8 mm square or 10 mm hexagon, or a 4 mm part', () => {
    const { job, segments } = compiled(
      [
        art([
          rectangle(40, 40, 120, 60),
          circle(60, 70, 8),
          circle(80, 70, 9),
          circle(100, 70, 10),
          rectangle(116, 66, 8, 8),
          hexagon(140, 70, 10),
          circle(200, 70, 4),
        ]),
      ],
      { cutType: 'profile-outside' },
    );

    expect(
      job.cncCompilation?.tabHoldShapes?.filter((shape) => shape.kind === 'narrow-bridge'),
    ).toEqual([]);
    // The holes are held: each Ø10 slug stays in two pieces of cut, not one.
    const hole = throughCut(segments, TAB_TOP, BIT, machineBox(95, 65, 10, 10, -0.01));
    expect(hole.pieces).toBeGreaterThanOrEqual(2);
  });

  it('names no narrow bridge on quarter-inch 12, 14 and 16 mm holes', () => {
    const { job } = compiled(
      [
        art([
          rectangle(40, 40, 120, 60),
          circle(60, 70, 12),
          circle(85, 70, 14),
          circle(115, 70, 16),
        ]),
      ],
      { cutType: 'profile-outside', toolId: 'em-6350' },
    );

    expect(
      job.cncCompilation?.tabHoldShapes?.filter((shape) => shape.kind === 'narrow-bridge'),
    ).toEqual([]);
  });

  it('still names the bridge an acute tip narrows', () => {
    const wedge: Polyline = {
      closed: true,
      points: [
        { x: 50, y: 50 },
        { x: 110, y: 50 },
        { x: 50, y: 50 + 60 * Math.tan(Math.PI / 9) },
      ],
    };
    const { job } = compiled(
      [
        art([wedge], {
          cncTabAnchors: [
            { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 60 / 145 },
          ],
        }),
      ],
      { cutType: 'profile-outside' },
    );

    const narrow = job.cncCompilation?.tabHoldShapes?.find(
      (shape) => shape.kind === 'narrow-bridge',
    );
    expect(narrow?.bridgeMm).toBeLessThan(3);
  });
});
