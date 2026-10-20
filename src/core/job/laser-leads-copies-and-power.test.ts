// Laser lead guards from the fifth review (ADR-626): copies that only split an
// edge differently, power that rounds to S0, the chord-only final pass, and
// recipe steps that store lead shape with leads off.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import { recipeStepFromLayer } from '../material-library/process-recipe-operation';
import { createLayer, type Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { withCutArcMoves } from './cut-arc-moves';
import type { CutGroup, CutSegment, Job } from './job';
import { leadJobLines } from './laser-lead-rings';
import type { CutGroupLaserLeads } from './laser-lead-settings';

const LEADS: CutGroupLaserLeads = {
  leadIn: true,
  leadOut: true,
  style: 'arc',
  lengthMm: 2,
  angleDeg: 90,
  side: 'auto',
  clearanceMm: 0.2,
  operationName: 'Cut',
};
const NO_BED = { bed: null };

function closed(points: ReadonlyArray<Vec2>): CutSegment {
  return { polyline: [...points, points[0] as Vec2], closed: true };
}

function square(x: number, y: number, size: number): CutSegment {
  return closed([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]);
}

function group(segments: ReadonlyArray<CutSegment>, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#ff0000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
    ...extra,
  };
}

function segmentOf(job: Job, groupIndex: number): CutSegment {
  const found = job.groups[groupIndex];
  if (found?.kind !== 'cut' || found.segments[0] === undefined) throw new Error('no cut');
  return found.segments[0];
}

describe('laser lead copies and power (ADR-626)', () => {
  it('takes an outline started mid-edge for a copy of the same outline', () => {
    const corners = square(0, 0, 40);
    // The same square, started in the middle of its bottom edge.
    const midStart = closed([
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 0 },
    ]);
    const hole = square(10, 10, 20);
    const job: Job = {
      groups: [group([corners]), group([midStart]), group([hole], { laserLeads: LEADS })],
    };
    expect(leadJobLines(job).copies[0]).toEqual([1]);
    const start = segmentOf(applyLaserLeads(job, NO_BED), 2).polyline[0] as Vec2;
    expect(pointInPolygon(start, hole.polyline)).toBe(true);
  });

  it('reads an outline whose power rounds to S0 as no part', () => {
    const job: Job = {
      groups: [
        group([square(0, 0, 40)], { power: 0.01 }),
        group([square(10, 10, 20)], { laserLeads: LEADS }),
      ],
    };
    const start = (done: Job) => segmentOf(done, 1).polyline[0] as Vec2;
    // 0.01% of S1000 is S0: nothing holds the square, so its scrap is outside.
    const onMachine = applyLaserLeads(job, { bed: null, device: DEFAULT_DEVICE_PROFILE });
    expect(pointInPolygon(start(onMachine), square(10, 10, 20).polyline)).toBe(false);
    const unknown = applyLaserLeads(job, NO_BED);
    expect(pointInPolygon(start(unknown), square(10, 10, 20).polyline)).toBe(true);
  });

  it('fits the final pass lead-out as the chords it goes out as', () => {
    const contour = square(0, 0, 10);
    const arcs = withCutArcMoves(
      contour,
      contour.polyline.slice(1).map((to) => ({ kind: 'line' as const, to })),
    );
    const job = (beside: number): Job => ({
      groups: [
        // A cut just below where the overcut's 2 mm arc lead-out ends.
        group([
          {
            polyline: [
              { x: 3.5, y: beside },
              { x: 5, y: beside },
            ],
            closed: false,
          },
        ]),
        group([arcs], { laserLeads: LEADS, finalPassOvercutMm: 3 }),
      ],
    });
    const lowest = (done: Job) => Math.min(...segmentOf(done, 1).polyline.map((p) => p.y));
    const free = applyLaserLeads(job(-10), NO_BED);
    expect(free.diagnostics).toBeUndefined();
    // 0.203 mm from the lead's chords: clear by the chords, short of the
    // 0.005 mm more an arc lead would keep.
    const tight = applyLaserLeads(job(lowest(free) - 0.203), NO_BED);
    expect(tight.diagnostics).toBeUndefined();
    expect(lowest(tight)).toBeCloseTo(lowest(free), 9);
  });

  it('leaves lead shape out of a recipe step when both leads are off', () => {
    const layer = createLayer({ id: 'cut', color: '#ff0000' });
    const off = recipeStepFromLayer({ ...layer, leadStyle: 'line', leadLengthMm: 5 });
    expect(off.settings).toEqual(recipeStepFromLayer(layer).settings);
    const on = recipeStepFromLayer({ ...layer, leadInEnabled: true, leadStyle: 'line' });
    expect(on.settings).toMatchObject({ leadInEnabled: true, leadStyle: 'line' });
  });
});
