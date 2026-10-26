// A plate drawn as one open path with a corner left open (ADR-626 Amendment
// 10; meta audit v1 2026-10-23, M6-P1-3 and M6-R1). Amendment 8 read open
// lines as an outline only where their ends came within 0.5 mm, so a wider
// gap, or exactly 0.5 mm, left the hole inside the plate looking like an outer
// contour: its leads burned 1.4 to 1.6 mm into the plate, and the plate lost
// its kerf offset, without a word. Each case runs the shipped pipeline and
// reads the G-code back.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type Vec2,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';
import { litSamples } from './laser-lit-samples.test-support';
import { prepareOutput } from './prepare-output';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const ARC_LEADS = { leadInEnabled: true, leadOutEnabled: true, leadLengthMm: 2 } as const;
const LINE_LEADS = { ...ARC_LEADS, leadStyle: 'line' } as const;
const GAPS = [0.5, 0.6, 1, 1.5];

/** An 80 mm plate drawn as one open path, its first corner `gapMm` open, with
 * an r5 hole in its middle. */
function project(gapMm: number, settings: Partial<Layer>): Project {
  const plate = [
    { x: 100 + gapMm, y: 100 },
    { x: 180, y: 100 },
    { x: 180, y: 180 },
    { x: 100, y: 180 },
    { x: 100, y: 100 },
  ];
  const hole = Array.from({ length: 64 }, (_, index) => ({
    x: 140 + 5 * Math.cos((index / 64) * 2 * Math.PI),
    y: 140 + 5 * Math.sin((index / 64) * 2 * Math.PI),
  }));
  const layer = { ...createLayer({ id: 'cut', color: '#ff0000', name: 'Cut' }), ...settings };
  return {
    ...createProject(DEVICE),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'plate',
          source: 'plate.svg',
          bounds: { minX: 100, minY: 100, maxX: 180, maxY: 180 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['cut'],
          paths: [
            {
              color: '#ff0000',
              polylines: [
                { closed: false, points: plate },
                { closed: true, points: hole },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Plate material: inside the plate deeper than 0.05 mm, outside the hole. */
function inPlate(point: Vec2): boolean {
  const deep = Math.min(point.x - 100, 180 - point.x, point.y - 100, 180 - point.y);
  return deep > 0.05 && Math.hypot(point.x - 140, point.y - 140) > 5.05;
}

function prepared(input: Project): Job {
  const output = prepareOutput(input);
  if (!output.ok) throw new Error('expected the project to prepare');
  return output.job;
}

function openSideUnknown(job: Job): number {
  return (job.diagnostics ?? []).reduce(
    (count, diagnostic) =>
      diagnostic.kind === 'laser-leads-side-unknown' && diagnostic.aroundOpenPaths === true
        ? count + diagnostic.count
        : count,
    0,
  );
}

describe('M6-P1-3: the hole of a plate left open at a corner', () => {
  for (const gap of GAPS) {
    for (const [style, leads] of [
      ['arc', ARC_LEADS],
      ['line', LINE_LEADS],
    ] as const) {
      it(`never leads into the plate, and says so, with the corner ${gap} mm open (${style} leads)`, () => {
        const input = project(gap, leads);
        const lit = litSamples(emitGcode(input).gcode, DEVICE);
        expect(lit.length).toBeGreaterThan(0);
        expect(lit.filter(inPlate)).toEqual([]);
        expect(openSideUnknown(prepared(input))).toBe(1);
      });
    }
  }
});

describe('M6-R1: kerf offset on a plate left open at a corner', () => {
  it('names the open plate, the gap to bridge and the hole offset the wrong way', () => {
    for (const [gap, shown] of [
      [0.6, '0.6'],
      [1, '1'],
      [1.5, '1.5'],
    ] as const) {
      const { preflight } = emitGcode(project(gap, { kerfOffsetMm: 0.2 }));
      const issue = preflight.issues.find((found) => found.code === 'line-open-outline');
      expect(issue?.message, `gap ${gap}`).toBe(
        `Layer "Cut": 1 outline is drawn as open paths whose ends stop up to ${shown} mm apart, ` +
          'so it is cut as open lines: no kerf offset, the shapes inside are kerf-offset as if ' +
          'it did not hold them and the shapes inside are not cut first. Select it and use ' +
          `Tools > Join paths (gap up to ${shown} mm) to close it.`,
      );
    }
  });

  it('says the same of a plate whose corner is left exactly 0.5 mm open', () => {
    const { preflight } = emitGcode(project(0.5, { kerfOffsetMm: 0.2 }));
    expect(preflight.issues.map((issue) => issue.code)).toContain('line-open-outline');
  });
});
