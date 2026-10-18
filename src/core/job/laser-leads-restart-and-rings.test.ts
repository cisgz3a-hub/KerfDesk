// Laser lead restarts on finely divided sides, and broken outlines kept only
// for jobs that ask for leads (ADR-626).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { pointInPolygon } from '../geometry';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type SceneObject, type Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import { compileJob } from './compile-job';
import type { CutGroup, CutSegment, Job } from './job';
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

/** A square whose every side is split into `pieces` equal chords. */
function dividedSquare(x: number, y: number, size: number, pieces: number): CutSegment {
  const corners = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  const points: Vec2[] = [];
  for (let side = 0; side < 4; side += 1) {
    const a = corners[side] as Vec2;
    const b = corners[(side + 1) % 4] as Vec2;
    for (let i = 0; i < pieces; i += 1) {
      points.push({ x: a.x + ((b.x - a.x) * i) / pieces, y: a.y + ((b.y - a.y) * i) / pieces });
    }
  }
  return { polyline: [...points, points[0] as Vec2], closed: true };
}

function plate(layer: Partial<Layer>, extraLayers: ReadonlyArray<Layer> = []) {
  const square = (min: number, max: number) => ({
    closed: true,
    points: [
      { x: min, y: min },
      { x: max, y: min },
      { x: max, y: max },
      { x: min, y: max },
    ],
  });
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'plate',
    source: 'plate.svg',
    bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [square(20, 60)] }],
  };
  return {
    layers: [{ ...createLayer({ id: 'cut', color: '#ff0000' }), ...layer }, ...extraLayers],
    objects: [object],
  };
}

describe('laser lead restarts and kept outlines (ADR-626)', () => {
  it('restarts a corner-started hole mid-side even when every side is many short chords', () => {
    const outer: CutSegment = dividedSquare(0, 0, 40, 1);
    const hole = dividedSquare(10, 10, 20, 40);
    const done = applyLaserLeads(
      { groups: [group([hole, outer], { laserLeads: LEADS })] },
      { bed: null },
    );
    const cut = done.groups[0];
    const led = cut?.kind === 'cut' ? cut.segments[0] : undefined;
    expect(led?.closed).toBe(false);
    expect(pointInPolygon(led?.polyline[0] as Vec2, hole.polyline)).toBe(true);
    expect(done.diagnostics).toBeUndefined();
  });

  it('keeps tabbed outlines on the cut group only when the scene asks for leads', () => {
    const tabs = { tabsEnabled: true, tabsPerShape: 4, tabSizeMm: 1 };
    const without = compileJob(plate(tabs), DEFAULT_DEVICE_PROFILE);
    expect(without.groups.some((g) => g.kind === 'cut' && g.topologyRings !== undefined)).toBe(
      false,
    );
    const leadsElsewhere = createLayer({ id: 'other', color: '#00ff00' });
    const withLeads = compileJob(
      plate(tabs, [{ ...leadsElsewhere, leadInEnabled: true }]),
      DEFAULT_DEVICE_PROFILE,
    );
    const rings = withLeads.groups.flatMap((g) =>
      g.kind === 'cut' ? (g.topologyRings ?? []) : [],
    );
    expect(rings).toHaveLength(1);
    const job: Job = withLeads;
    expect(applyLaserLeads(job, { bed: null }).groups.some((g) => 'topologyRings' in g)).toBe(
      false,
    );
  });
});
