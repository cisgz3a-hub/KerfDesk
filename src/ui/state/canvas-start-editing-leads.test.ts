// Editing where a job starts when its first contour has laser leads (ADR-626):
// the start is picked on the contour's closed outline, not on its leads' ends.

import { describe, expect, it } from 'vitest';
import type { CutGroup, CutSegment, Job } from '../../core/job';
import { jobStartPointOptions, resolveJobStartPoint } from '../../core/job/job-start-point';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Vec2 } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildCanvasStartEditingData } from './canvas-start-editing-data';

function project() {
  const square = [
    { x: 20, y: 20 },
    { x: 60, y: 20 },
    { x: 60, y: 60 },
    { x: 20, y: 60 },
  ];
  const base = createProject();
  return {
    ...base,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'cut', color: '#ff0000' }),
          leadInEnabled: true,
          leadOutEnabled: true,
        },
      ],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'plate',
          source: 'plate.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 20, minY: 20, maxX: 60, maxY: 60 },
          paths: [{ color: '#ff0000', polylines: [{ closed: true, points: square }] }],
        },
      ],
    },
  };
}

function firstCut(job: Job): CutSegment {
  const group = job.groups.find((candidate): candidate is CutGroup => candidate.kind === 'cut');
  const segment = group?.segments[0];
  if (segment === undefined) throw new Error('no cut');
  return segment;
}

describe('editing where a led job starts (ADR-626)', () => {
  it('picks the start on the closed outline, not on the leads', () => {
    const input = project();
    const prepared = prepareOutput(input);
    if (!prepared.ok) throw new Error('expected the project to prepare');
    const led = firstCut(prepared.job);
    expect(led.closed).toBe(false);
    const data = buildCanvasStartEditingData(prepared);
    const contour = firstCut(data.job);
    expect(contour.closed).toBe(true);
    // Halfway along an edge of the outline, away from where it starts now.
    const a = contour.polyline[1] as Vec2;
    const b = contour.polyline[2] as Vec2;
    const target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const options = jobStartPointOptions(
      input.optimization,
      input.device.scanningOffsets,
      input.device,
    );
    const picked = resolveJobStartPoint(data.job, target, options);
    expect(picked?.supported).toBe(true);
    expect(Math.hypot((picked?.point.x ?? 0) - target.x, (picked?.point.y ?? 0) - target.y)).toBe(
      0,
    );
    // The led burn alone offers only its two ends.
    const ends = resolveJobStartPoint(prepared.job, target, options);
    expect(
      Math.hypot((ends?.point.x ?? 0) - target.x, (ends?.point.y ?? 0) - target.y),
    ).toBeGreaterThan(1);
  });
});
