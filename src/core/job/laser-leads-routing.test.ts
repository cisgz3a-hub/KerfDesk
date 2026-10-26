// Laser leads and what the output really writes (ADR-626): a contour too small
// to be written gets no lead, and lead-heavy jobs are prepared off the UI thread.

import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Layer, type Vec2 } from '../scene';
import { polylineToCurveSubpath } from '../scene/curve-path';
import { applyLaserLeads } from './apply-laser-leads';
import type { CutGroup, CutSegment } from './job';
import type { CutGroupLaserLeads } from './laser-lead-settings';
import { outputVectorPreparationTooComplex } from './preparation-complexity';

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

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#ff0000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
    laserLeads: LEADS,
  };
}

/** Many small closed triangles on one Line operation, as polylines or, as a
 * saved project stores them, as canonical curves with no polylines. */
function triangles(count: number, layer: Partial<Layer>, asCurves = false) {
  const polylines = Array.from({ length: count }, (_, index) => {
    const x = (index % 100) * 5;
    const y = Math.floor(index / 100) * 5;
    return {
      closed: true,
      points: [
        { x, y },
        { x: x + 3, y },
        { x, y: y + 3 },
      ],
    };
  });
  return {
    ...createProject(),
    scene: {
      layers: [{ ...createLayer({ id: 'cut', color: '#ff0000' }), ...layer }],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'art',
          source: 'art.svg',
          bounds: { minX: 0, minY: 0, maxX: 500, maxY: 300 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            asCurves
              ? { color: '#ff0000', polylines: [], curves: polylines.map(polylineToCurveSubpath) }
              : { color: '#ff0000', polylines },
          ],
        },
      ],
    },
  };
}

describe('laser leads and the written output (ADR-626)', () => {
  it('gives no lead to a contour that rounds to one written point', () => {
    const tiny: CutSegment = {
      polyline: [
        { x: 10, y: 10 },
        { x: 10.0004, y: 10 },
        { x: 10, y: 10.0004 },
        { x: 10, y: 10 },
      ] as Vec2[],
      closed: true,
    };
    const done = applyLaserLeads({ groups: [group([tiny])] }, { bed: null });
    const cut = done.groups[0];
    expect(cut?.kind === 'cut' ? cut.segments[0] : undefined).toBe(tiny);
    expect(done.diagnostics).toBeUndefined();
  });

  it('prepares a job off the UI thread when its leads are most of the work', () => {
    const plain = triangles(6000, {});
    expect(outputVectorPreparationTooComplex(plain)).toBe(false);
    const led = triangles(6000, { leadInEnabled: true, leadOutEnabled: true, leadLengthMm: 20 });
    expect(outputVectorPreparationTooComplex(led)).toBe(true);
    // Leads off by default leave the routing as it was.
    const stored = triangles(6000, { leadStyle: 'line', leadLengthMm: 20 });
    expect(outputVectorPreparationTooComplex(stored)).toBe(false);
  });

  it('counts the contours of artwork stored as curves', () => {
    const leads = { leadInEnabled: true, leadOutEnabled: true, leadLengthMm: 20 };
    expect(outputVectorPreparationTooComplex(triangles(6000, {}, true))).toBe(false);
    expect(outputVectorPreparationTooComplex(triangles(6000, leads, true))).toBe(true);
  });
});
