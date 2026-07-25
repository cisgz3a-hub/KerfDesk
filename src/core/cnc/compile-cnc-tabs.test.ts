// compileCncJob holding-tab behavior (ADR-258): a tabbed deep profile pass is ONE
// continuous path3d that rises to the tab top at each tab, rather than N open
// contour pieces that each replunge at full depth.
//
// Split out of compile-cnc-job.test.ts, which reached the 400-line cap.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Scene,
} from '../scene';
import type { CncGroup, CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

// XY of any pass, whichever kind. A tabbed or led pass is a path3d, so tests that
// reason about shape extent cannot assume a contour pass.
function passXyPoints(pass: CncPass): ReadonlyArray<{ x: number; y: number }> {
  if (pass.kind === 'path3d') return pass.points;
  if (pass.kind === 'contour') return pass.polyline;
  return [];
}

function passZs(pass: CncPass): ReadonlyArray<number> {
  if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
  if (pass.kind === 'contour') return [pass.zMm];
  return [];
}

// ADR-258 tab walls: consecutive point pairs whose Z steps upward. One per tab on a
// tabbed deep pass; none on an ordinary or led pass.
function tabRisesIn(pass: CncPass): ReadonlyArray<{ from: number; to: number }> {
  if (pass.kind !== 'path3d') return [];
  const rises: Array<{ from: number; to: number }> = [];
  for (let index = 1; index < pass.points.length; index += 1) {
    const previous = pass.points[index - 1];
    const current = pass.points[index];
    if (previous === undefined || current === undefined) continue;
    if (current.z > previous.z) rises.push({ from: previous.z, to: current.z });
  }
  return rises;
}

function squareObject(id: string, color: string, size: number, at = 50): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

function cncLayer(id: string, color: string, cnc: Partial<CncLayerSettings>): Layer {
  return { ...createLayer({ id, color }), cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc } };
}

function sceneWith(layers: Layer[], objects: ImportedSvg[]): Scene {
  return { objects, layers };
}

function onlyGroup(scene: Scene): CncGroup {
  const job = compileCncJob(scene, dev, config);
  expect(job.groups).toHaveLength(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  return group;
}

describe('compileCncJob holding tabs (ADR-258)', () => {
  it('rides deep profile passes over the tabs in one continuous path', () => {
    const group = onlyGroup(
      sceneWith(
        [
          cncLayer('L1', '#ff0000', {
            cutType: 'profile-outside',
            depthMm: 6,
            depthPerPassMm: 2,
            tabsEnabled: true,
            tabHeightMm: 2,
            tabWidthMm: 6,
            tabsPerShape: 4,
          }),
        ],
        [squareObject('O1', '#ff0000', 40)],
      ),
    );
    // Tab top sits at -(6-2) = -4. The -6 pass is ONE path3d that rises to -4 at
    // each of the 4 tabs. Under the split model this was 4 separate open pieces,
    // each replunging to -6 on the finished wall.
    const rises = group.passes.flatMap(tabRisesIn);
    expect(rises).toHaveLength(4);
    expect(new Set(rises.map((rise) => rise.from))).toEqual(new Set([-6]));
    expect(new Set(rises.map((rise) => rise.to))).toEqual(new Set([-4]));
    const deepPasses = group.passes.filter(
      (pass) => pass.kind === 'path3d' && pass.points.some((point) => point.z === -6),
    );
    expect(deepPasses).toHaveLength(1);
  });

  it('inserts a full-loop pass at the exact tab top so tabs are the requested height', () => {
    // Single-pass through-cut: without a pass at the tab top the only pass is
    // tabbed and the "tabs" are full stock thickness (the windows are simply never
    // cut). The ladder must gain a full loop at -(depth-tab).
    const group = onlyGroup(
      sceneWith(
        [
          cncLayer('L1', '#ff0000', {
            cutType: 'profile-outside',
            depthMm: 3,
            depthPerPassMm: 3,
            tabsEnabled: true,
            tabHeightMm: 1,
            tabWidthMm: 6,
            tabsPerShape: 4,
          }),
        ],
        [squareObject('O1', '#ff0000', 40)],
      ),
    );
    // That tab-top pass is a full closed loop, so ADR-250 leads convert it to a led
    // path3d — hence Z is read from points rather than from a contour pass.
    expect(new Set(group.passes.flatMap(passZs))).toContain(-2);
    const rises = group.passes.flatMap(tabRisesIn);
    expect(rises).toHaveLength(4);
    expect(new Set(rises.map((rise) => rise.from))).toEqual(new Set([-3]));
    expect(new Set(rises.map((rise) => rise.to))).toEqual(new Set([-2]));
  });

  it('keeps holding tabs on the finishing pass so the part is not fully severed', () => {
    const allowanceMm = 2;
    const group = onlyGroup(
      sceneWith(
        [
          cncLayer('L1', '#ff0000', {
            cutType: 'profile-outside',
            depthMm: 6,
            depthPerPassMm: 2,
            finishAllowanceMm: allowanceMm,
            tabsEnabled: true,
            tabHeightMm: 2,
            tabWidthMm: 6,
            tabsPerShape: 4,
          }),
        ],
        [squareObject('O1', '#ff0000', 40)],
      ),
    );
    // Passes are in machine coordinates, so derive the shape centre from the
    // overall bounding box (the inflated roughing extent). Every roughing pass
    // reaches that extent; every true-contour finishing pass reaches one allowance
    // short of it — a clean offset/scale-invariant classifier.
    const pts = group.passes.flatMap(passXyPoints);
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    const reach = (pass: CncPass): number =>
      Math.max(...passXyPoints(pass).map((p) => Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy))));
    const roughReach = Math.max(...group.passes.map(reach));
    const finishing = group.passes.filter((pass) => reach(pass) <= roughReach - allowanceMm / 2);
    // The finishing loop is ONE continuous pass that rises over each tab. The
    // property is unchanged — the part is still not fully severed, because material
    // is left at each tab — but the bridges are Z-rises, not gaps between pieces.
    expect(finishing).toHaveLength(1);
    const finishingPass = finishing[0];
    expect(finishingPass).toBeDefined();
    if (finishingPass === undefined) return;
    const rises = tabRisesIn(finishingPass);
    expect(rises).toHaveLength(4);
    expect(new Set(rises.map((rise) => rise.to))).toEqual(new Set([-4]));
    expect(passZs(finishingPass)).toContain(-6);
  });
});
