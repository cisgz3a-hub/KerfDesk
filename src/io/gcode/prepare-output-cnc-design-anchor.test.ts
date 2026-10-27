// ADR-327 Amendment 1 (meta audit M7-P2-3, 2026-09-24 CO-3): CNC Job Origin
// anchors on the artwork as drawn, never on the cutter's reach. Frame, the
// envelope and the no-go checks keep measuring the reach.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { computeFrameJobMotionBounds, computeJobPlacementBounds } from '../../core/job/job-bounds';
import { buildToolpath } from '../../core/job/toolpath';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncCutType,
  type Project,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

const COLOR = '#2563eb';
const END_MILL = { id: 'em-3175', name: '1/8" end mill', kind: 'end-mill', diameterMm: 3.175 };
const V_BIT_90 = {
  id: 'vb-90',
  name: '90° V-bit 12.7 mm',
  kind: 'v-bit',
  diameterMm: 12.7,
  tipAngleDeg: 90,
} as const;

function project(cutType: CncCutType, toolId: string, depthMm: number): Project {
  const base = createProject({ ...DEFAULT_DEVICE_PROFILE, bedWidth: 400, bedHeight: 300 });
  const layer = createLayer({ id: 'design', color: COLOR });
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [{ ...END_MILL, kind: 'end-mill' }, V_BIT_90],
      toolId,
    },
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds: { minX: 20, minY: 30, maxX: 70, maxY: 80 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: COLOR,
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 20, y: 30 },
                    { x: 70, y: 30 },
                    { x: 70, y: 80 },
                    { x: 20, y: 80 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [
        {
          ...layer,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType,
            toolId,
            depthMm,
            depthPerPassMm: depthMm,
            tabsEnabled: false,
          },
        },
      ],
    },
  };
}

function preparedAtUserOrigin(input: Project) {
  const prepared = prepareOutput(input, {
    jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
  });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  return prepared;
}

describe('CNC Job Origin anchors the artwork (ADR-327 Amendment 1)', () => {
  it.each([
    ['1/8" Outside profile', 'profile-outside', 'em-3175', 6, 3.175],
    ['1/8" On-path profile', 'profile-on-path', 'em-3175', 6, 1.5875],
    ['0.5 mm engraving with a 12.7 mm 90° V-bit', 'engrave', 'vb-90', 0.5, 6.35],
  ] as const)('%s puts the artwork corner on work zero', (_, cutType, toolId, depth, reachMm) => {
    const prepared = preparedAtUserOrigin(project(cutType, toolId, depth));
    const anchor = computeJobPlacementBounds(prepared.job, prepared.project.device);
    expect(anchor?.minX).toBeCloseTo(0, 6);
    expect(anchor?.minY).toBeCloseTo(0, 6);
    expect(anchor?.maxX).toBeCloseTo(50, 6);
    expect(anchor?.maxY).toBeCloseTo(50, 6);
    // Frame and the envelope checks still trace where the cutter reaches,
    // which now runs past work zero by at least its reach outside the outline
    // (a profile lead-in reaches further).
    const frame = computeFrameJobMotionBounds(prepared.job, prepared.project.device);
    expect(frame?.minX).toBeLessThanOrEqual(-reachMm + 0.001);
    expect(frame?.minY).toBeLessThanOrEqual(-reachMm + 0.001);
  });

  it('cuts an on-path engraving through the work-zero corner', () => {
    const prepared = preparedAtUserOrigin(project('engrave', 'vb-90', 0.5));
    const cutPoints = buildToolpath(prepared.job).steps.flatMap((step) =>
      step.kind === 'cut' ? step.polyline : [],
    );
    expect(cutPoints.some((p) => Math.hypot(p.x, p.y) < 0.001)).toBe(true);
  });

  it('keeps the placed design extent with the placed toolpaths', () => {
    const prepared = preparedAtUserOrigin(project('profile-outside', 'em-3175', 6));
    for (const group of prepared.job.groups) {
      if (group.kind !== 'cnc') continue;
      expect(group.designBounds?.minX).toBeCloseTo(0, 6);
      expect(group.designBounds?.minY).toBeCloseTo(0, 6);
    }
  });

  it('anchors a pocket containing a zero-signed-area bowtie on all of its artwork', () => {
    const base = project('pocket', 'em-3175', 1);
    const input: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [
          {
            kind: 'imported-svg',
            id: 'bowtie-and-square',
            source: 'bowtie-and-square.svg',
            bounds: { minX: 20, minY: 20, maxX: 120, maxY: 80 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: COLOR,
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 20, y: 20 },
                      { x: 80, y: 80 },
                      { x: 20, y: 80 },
                      { x: 80, y: 20 },
                    ],
                  },
                  {
                    closed: true,
                    points: [
                      { x: 100, y: 20 },
                      { x: 120, y: 20 },
                      { x: 120, y: 40 },
                      { x: 100, y: 40 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const prepared = preparedAtUserOrigin(input);
    expect(computeJobPlacementBounds(prepared.job, prepared.project.device)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 60,
    });
    // Check actual compiled motion too: omitting the bowtie from the anchor
    // placed its cuts about 78 mm left and 40 mm below work zero.
    const frame = computeFrameJobMotionBounds(prepared.job, prepared.project.device);
    expect(frame).not.toBeNull();
    expect(frame!.minX).toBeGreaterThanOrEqual(-0.001);
    expect(frame!.minY).toBeGreaterThanOrEqual(-0.001);
    expect(frame!.maxX).toBeCloseTo(100, 2);
    expect(frame!.maxY).toBeCloseTo(60, 2);
  });
});
