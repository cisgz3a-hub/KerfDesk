// ADR-140 Amendment 1: a hole or slot too narrow for the roughing offset (between
// one cutter width and a cutter width plus twice the allowance) keeps only its
// finishing path. Before the fix that path was one full-depth pass, a 6.35 mm
// plunge and full-width cut in solid stock with a 1/8" bit. It now follows the
// layer's depth ladder, while a finishing pass beside a roughed wall stays one
// full-depth pass.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import type { CncGroup, CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';

const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

function circle(cx: number, cy: number, radius: number): Polyline {
  const points: Vec2[] = [];
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return { closed: true, points };
}

function rectangle(minX: number, minY: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
    ],
  };
}

function artwork(polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function compiledPasses(
  polylines: ReadonlyArray<Polyline>,
  settings: Partial<CncLayerSettings>,
): ReadonlyArray<CncPass> {
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: 6.35,
      depthPerPassMm: 2,
      tabsEnabled: false,
      profileLead: { shape: 'none' as const },
      ...settings,
    },
  };
  const job = compileCncJob(
    { objects: [artwork(polylines)], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    config,
  );
  return job.groups.flatMap((group) => (group.kind === 'cnc' ? cncPasses(group) : []));
}

function cncPasses(group: CncGroup): ReadonlyArray<CncPass> {
  return group.passes;
}

type Size = { readonly width: number; readonly height: number };

// Z of every contour pass whose path has the given size. Sizes, not positions:
// the compiler maps drawing Y into the machine frame.
function contourZs(passes: ReadonlyArray<CncPass>, ofSize: (size: Size) => boolean): number[] {
  return passes.flatMap((pass) =>
    pass.kind === 'contour' && ofSize(sizeOf(pass.polyline)) ? [pass.zMm] : [],
  );
}

function sizeOf(points: ReadonlyArray<Vec2>): Size {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// The 4 mm hole's finishing circle is 4 - 3.175 = 0.825 mm across.
const smallHole = (size: Size): boolean => size.width < 1 && size.height < 1;
// The 40 mm part's outer roughing and finishing loops are over 43 mm across.
const outerWall = (size: Size): boolean => size.width > 43;

describe('finish-only features follow the depth ladder (ADR-140 Amendment 1)', () => {
  it('cuts a 4 mm hole the roughing offset skips in 2 mm passes', () => {
    const passes = compiledPasses([rectangle(10, 10, 40, 40), circle(30, 30, 2)], {
      finishAllowanceMm: 0.5,
    });

    expect(contourZs(passes, smallHole)).toEqual([-2, -4, -6, -6.35]);
    // The outer wall was roughed: 4 roughing passes, then one finishing pass.
    expect(contourZs(passes, outerWall)).toEqual([-2, -4, -6, -6.35, -6.35]);
  });

  it('keeps one full-depth finishing pass in a hole large enough to rough', () => {
    const passes = compiledPasses([rectangle(10, 10, 40, 40), circle(30, 30, 8)], {
      finishAllowanceMm: 0.5,
    });
    // Roughing circle 16 - 2 x 2.0875 = 11.8 mm across, finishing 12.8 mm.
    const holeLoops = (size: Size): boolean => size.width > 11 && size.width < 14;

    expect(contourZs(passes, holeLoops)).toEqual([-2, -4, -6, -6.35, -6.35]);
  });

  it('cuts a narrow slot in the same passes', () => {
    const passes = compiledPasses([rectangle(10, 10, 40, 40), rectangle(20, 28.1, 20, 3.8)], {
      finishAllowanceMm: 0.5,
    });
    // The finishing loop is 20 - 3.175 = 16.8 mm long and 0.625 mm wide.
    const slotLoop = (size: Size): boolean => size.width < 20 && size.height < 1;

    expect(contourZs(passes, slotLoop)).toEqual([-2, -4, -6, -6.35]);
  });

  it('cuts a small hole alone on an inside-profile layer instead of dropping the layer', () => {
    const passes = compiledPasses([circle(30, 30, 2)], {
      cutType: 'profile-inside',
      finishAllowanceMm: 0.5,
    });

    expect(contourZs(passes, smallHole)).toEqual([-2, -4, -6, -6.35]);
  });

  it('cuts an allowance of the bit radius or more as the radius, stepping the finish down', () => {
    // ADR-140 Amendment 2 (CNC audit v1 F3-P2-1). A 4 mm allowance used to put
    // the roughing loop 40 + 2 x (1.5875 + 4) = 51.2 mm across and finish in one
    // 6.35 mm deep pass with the whole bit in solid stock.
    const passes = compiledPasses([rectangle(10, 10, 40, 40)], { finishAllowanceMm: 4 });
    // Roughing at one cut width out: 40 + 2 x 3.175 = 46.35 mm across.
    const roughing = (size: Size): boolean => size.width > 46 && size.width < 47;
    // Finishing at the radius: 43.175 mm across.
    const finishing = (size: Size): boolean => size.width > 43 && size.width < 44;

    expect(contourZs(passes, roughing)).toEqual([-2, -4, -6, -6.35]);
    expect(contourZs(passes, finishing)).toEqual([-2, -4, -6, -6.35]);
  });

  it('keeps one full-depth finishing pass for an allowance just under the radius', () => {
    const passes = compiledPasses([rectangle(10, 10, 40, 40)], { finishAllowanceMm: 1.5 });
    const finishing = (size: Size): boolean => size.width > 43 && size.width < 44;

    expect(contourZs(passes, finishing)).toEqual([-6.35]);
  });

  it('still drops a hole narrower than the bit', () => {
    const passes = compiledPasses([circle(30, 30, 1.5)], {
      cutType: 'profile-inside',
      finishAllowanceMm: 0.5,
    });

    expect(passes).toEqual([]);
  });
});
