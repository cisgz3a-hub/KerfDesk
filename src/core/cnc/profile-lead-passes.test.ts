import { describe, expect, it } from 'vitest';
import type { MachineBounds } from '../devices';
import type { CncContourPass, CncPass } from '../job';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings, type Vec2 } from '../scene';
import { applyProfileLeadPasses, resolveProfileLeadOptions } from './profile-lead-passes';

const BED: MachineBounds = { width: 300, height: 300, minX: 0, minY: 0, maxX: 300, maxY: 300 };
const TOOL_MM = 3.175;

// A ring-closed CCW square (the shape contourPassFromPolyline emits), placed
// clear of the bed edge so its exterior leads fit inside the bed.
function squarePass(closed = true): CncContourPass {
  return {
    kind: 'contour',
    zMm: -1.5,
    closed,
    polyline: [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
      { x: 50, y: 60 },
      { x: 50, y: 50 },
    ],
  };
}

// A ring-closed contour pass built from CCW corners, at cut depth.
function cpass(corners: ReadonlyArray<Vec2>): CncContourPass {
  const first = corners[0]!;
  return { kind: 'contour', zMm: -1.5, closed: true, polyline: [...corners, first] };
}

function settings(overrides: Partial<CncLayerSettings>): CncLayerSettings {
  return { ...DEFAULT_CNC_LAYER_SETTINGS, ...overrides };
}

function apply(passes: ReadonlyArray<CncPass>, over: Partial<CncLayerSettings>) {
  return applyProfileLeadPasses(passes, settings(over), TOOL_MM, BED);
}

describe('applyProfileLeadPasses — default-on', () => {
  it('applies a default tool-radius arc lead when the layer sets no lead', () => {
    const result = apply([squarePass()], { cutType: 'profile-outside' });
    expect(result[0]?.kind).toBe('path3d');
  });

  it('opts out back to the straight plunge with shape "none"', () => {
    const passes = [squarePass()];
    expect(apply(passes, { cutType: 'profile-outside', profileLead: { shape: 'none' } })).toBe(
      passes,
    );
  });
});

describe('applyProfileLeadPasses — arc lead applied', () => {
  it('converts a closed outside profile pass into a led path3d plunging in the waste', () => {
    const result = apply([squarePass()], {
      cutType: 'profile-outside',
      profileLead: { shape: 'arc' },
    });
    const pass = result[0];
    if (pass?.kind !== 'path3d') throw new Error('expected a path3d pass');
    expect(pass.closed).toBe(false);
    const plunge = pass.points[0] as Vec2;
    expect(plunge.x).toBeLessThan(50); // exterior of the CCW square is left/below the start
    expect(plunge.y).toBeLessThan(50);
    for (const point of pass.points) expect(point.z).toBe(-1.5); // whole lead rides cut depth
    // the contour vertices survive between the leads
    expect(pass.points.some((p) => Math.abs(p.x - 60) < 1e-9 && Math.abs(p.y - 50) < 1e-9)).toBe(
      true,
    );
  });

  it('walks plunge -> lead-in -> full contour -> lead-out with no gap', () => {
    const result = apply([squarePass()], {
      cutType: 'profile-outside',
      profileLead: { shape: 'arc' },
    });
    const pass = result[0];
    if (pass?.kind !== 'path3d') throw new Error('expected a path3d pass');
    const has = (x: number, y: number) =>
      pass.points.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
    // every corner of the (50,50)-(60,60) square survives in the loop
    expect(has(50, 50) && has(60, 50) && has(60, 60) && has(50, 60)).toBe(true);
    // the entry vertex appears at least twice: lead-in end AND the loop close
    const entryCount = pass.points.filter(
      (p) => Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y - 50) < 1e-9,
    ).length;
    expect(entryCount).toBeGreaterThanOrEqual(2);
  });
});

describe('applyProfileLeadPasses — per-contour side & sibling parts', () => {
  it('leads the outer boundary but keeps an interior hole from gouging the part', () => {
    const outer = cpass([
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 50, y: 150 },
    ]);
    // Wound opposite to the outer, as the kerf offset actually emits a hole.
    const hole = cpass([
      { x: 90, y: 90 },
      { x: 90, y: 110 },
      { x: 110, y: 110 },
      { x: 110, y: 90 },
    ]);
    const result = apply([outer, hole], { cutType: 'profile-outside' }); // default-on arc
    expect(result[0]?.kind).toBe('path3d'); // outer: exterior lead in the surrounding waste
    // The hole is cut inside its boundary, so its inside-side corner lead pokes
    // into the part; the self-collision guard drops it — no gouge (was the P1).
    expect(result[1]?.kind).toBe('contour');
  });

  it('drops a lead that would reach into a disjoint sibling part', () => {
    const a = cpass([
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 120 },
      { x: 100, y: 120 },
    ]);
    const b = cpass([
      { x: 90, y: 90 },
      { x: 99, y: 90 },
      { x: 99, y: 99 },
      { x: 90, y: 99 },
    ]);
    const result = apply([a, b], { cutType: 'profile-outside' });
    expect(result[0]?.kind).toBe('contour'); // a's plunge lands inside sibling b -> fallback
    expect(result[1]?.kind).toBe('path3d'); // b's lead is clear of a
  });

  it('keeps an inside-side lead on every depth pass, not only the first', () => {
    // Real jobs cut a profile in several depth passes, and contourPassFromPolyline
    // clones the ring for each one. The self-collision guard must recognize a
    // contour's own shape by GEOMETRY, not array identity — otherwise depth pass
    // #2+ mistakes its own cloned ring for a disjoint sibling and drops the lead
    // back to a straight plunge onto the finished wall (the entry mark ADR-250
    // exists to prevent). The start vertex sits at the right-edge midpoint, the
    // kind of point pointInPolygon classifies as outside and the kind of
    // mid-segment start rotateStartToLongestSegment produces in the pipeline.
    const corners: Vec2[] = [
      { x: 60, y: 70 },
      { x: 60, y: 90 },
      { x: 50, y: 90 },
      { x: 50, y: 50 },
      { x: 60, y: 50 },
    ];
    const depthPass = (zMm: number): CncContourPass => ({
      kind: 'contour',
      zMm,
      closed: true,
      polyline: [...corners, corners[0]!],
    });
    const result = apply([depthPass(-1.5), depthPass(-3)], { cutType: 'profile-inside' });
    expect(result[0]?.kind).toBe('path3d'); // first pass leads into the interior
    expect(result[1]?.kind).toBe('path3d'); // second pass must ALSO lead, not plunge
  });
});

describe('applyProfileLeadPasses — skips', () => {
  it('leaves on-path cuts alone (no waste side)', () => {
    const passes = [squarePass()];
    expect(apply(passes, { cutType: 'profile-on-path', profileLead: { shape: 'arc' } })).toBe(
      passes,
    );
  });

  it('yields to ramp entry when a ramp angle is configured', () => {
    const passes = [squarePass()];
    expect(
      apply(passes, { cutType: 'profile-outside', rampEntryDeg: 5, profileLead: { shape: 'arc' } }),
    ).toBe(passes);
  });

  it('leaves open contour passes as straight-plunge contours', () => {
    const result = apply([squarePass(false)], {
      cutType: 'profile-outside',
      profileLead: { shape: 'arc' },
    });
    expect(result[0]?.kind).toBe('contour');
  });

  it('falls back to the legacy plunge when the lead would exceed the bed', () => {
    const tightBed: MachineBounds = { ...BED, minX: 50, minY: 50 };
    const result = applyProfileLeadPasses(
      [squarePass()],
      settings({ cutType: 'profile-outside', profileLead: { shape: 'arc' } }),
      TOOL_MM,
      tightBed,
    );
    expect(result[0]?.kind).toBe('contour');
  });

  it('falls back when the lead is too large and collides with the part', () => {
    const result = apply([squarePass()], {
      cutType: 'profile-inside',
      profileLead: { shape: 'arc', radiusMm: 20 }, // dwarfs the 10 mm hole
    });
    expect(result[0]?.kind).toBe('contour');
  });
});

describe('resolveProfileLeadOptions', () => {
  it('defaults to a tool-radius arc when the layer sets no lead', () => {
    expect(resolveProfileLeadOptions(undefined, TOOL_MM)).toEqual({
      shape: 'arc',
      radiusMm: TOOL_MM / 2,
    });
  });

  it('is null when the lead is explicitly disabled', () => {
    expect(resolveProfileLeadOptions({ shape: 'none' }, TOOL_MM)).toBeNull();
  });

  it('defaults the lead radius to the tool radius', () => {
    expect(resolveProfileLeadOptions({ shape: 'arc' }, 6)).toEqual({ shape: 'arc', radiusMm: 3 });
  });

  it('honors an explicit radius and sweep', () => {
    expect(resolveProfileLeadOptions({ shape: 'line', radiusMm: 8, sweepDeg: 45 }, 6)).toEqual({
      shape: 'line',
      radiusMm: 8,
      sweepDeg: 45,
    });
  });
});
