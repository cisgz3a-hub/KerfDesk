import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import type { CncContourPass } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  type CncLayerSettings,
  type Polyline,
  type Vec2,
} from '../scene';
import { cncGroupForLayer } from './compile-cnc-job';
import { computeProfileLead } from './profile-lead';
import { applyProfileLeadPasses } from './profile-lead-passes';

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function contour(points: readonly Vec2[]): CncContourPass {
  return { kind: 'contour', zMm: -1, closed: true, polyline: [...points, points[0]!] };
}

const MAIN = rectangle(50, 50, 20, 20);
const BED = { width: 400, height: 400, minX: 0, minY: 0, maxX: 400, maxY: 400 };
const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  cutType: 'profile-outside',
  tabsEnabled: false,
  depthMm: 1,
  depthPerPassMm: 1,
  profileLead: { shape: 'line', radiusMm: 10 },
};
const LAYER = { ...createLayer({ id: 'cut', color: '#000000' }), cnc: SETTINGS };

function compile(shapes: readonly Polyline[]) {
  const group = cncGroupForLayer(
    LAYER,
    SETTINGS,
    shapes,
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  if (group === null) throw new Error('expected a CNC group');
  return group;
}

describe('CNC profile lead segment clearance', () => {
  it('drops a line lead crossing a sibling even though both endpoints are outside', () => {
    const group = compile([MAIN, rectangle(41.913, 58.5005, 3, 3)]);
    expect(group.passes[0]?.kind).toBe('contour');
    const gcode = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    // The original full-depth lead starts here and cuts through the kept 3mm part.
    expect(gcode).not.toContain('G0 X38.413 Y60.001');
    expect(gcode).toContain('G0 X48.413 Y60.001');
  });

  it('accounts for the cutter footprint through the offset sibling contour', () => {
    // The lead centre is at Y60.0005, outside the raw sibling. Its 1.5875mm
    // cutter radius still reaches this finished part, whose lower edge is Y60.5.
    const group = compile([MAIN, rectangle(41.913, 60.5005, 3, 3)]);
    expect(group.passes[0]?.kind).toBe('contour');
  });

  it('retains exactly the same clear lead beside a distant sibling', () => {
    const alone = compile([MAIN]);
    const separate = compile([MAIN, rectangle(10, 10, 3, 3)]);
    expect(alone.passes[0]?.kind).toBe('path3d');
    expect(separate.passes[0]).toEqual(alone.passes[0]);
  });

  it('drops an arc whose emitted chord crosses a thin sibling between sampled vertices', () => {
    const pass = contour(rectangle(100, 100, 20, 20).points);
    const options = { shape: 'arc' as const, radiusMm: 10 };
    const result = computeProfileLead({ closed: true, points: pass.polyline }, 'outside', options);
    if (!result.ok) throw new Error('expected a valid arc');
    const [start, end] = result.lead.leadIn;
    const midpoint = { x: (start!.x + end!.x) / 2, y: (start!.y + end!.y) / 2 };
    const sibling = contour(rectangle(midpoint.x - 0.001, midpoint.y - 0.001, 0.002, 0.002).points);
    expect(result.lead.leadIn.every((point) => !pointInPolygon(point, sibling.polyline))).toBe(
      true,
    );
    const passes = applyProfileLeadPasses(
      [pass, sibling],
      { ...SETTINGS, profileLead: options },
      3.175,
      BED,
    );
    expect(passes[0]).toBe(pass);
  });

  it('drops a line crossing a concave finger of its own kept part', () => {
    // The entry sits on the main lower edge. A disjoint-looking finger of the
    // same connected contour crosses the lead at Y43..46.
    const pass = contour([
      { x: 60, y: 50 },
      { x: 70, y: 50 },
      { x: 70, y: 70 },
      { x: 50, y: 70 },
      { x: 50, y: 43 },
      { x: 65, y: 43 },
      { x: 65, y: 46 },
      { x: 55, y: 46 },
      { x: 55, y: 50 },
    ]);
    const result = applyProfileLeadPasses([pass], SETTINGS, 3.175, BED);
    expect(result[0]).toBe(pass);
  });
});
