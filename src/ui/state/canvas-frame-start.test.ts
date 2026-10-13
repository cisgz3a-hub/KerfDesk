import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { createProject } from '../../core/scene';
import { buildCanvasMarkerPlan } from './canvas-motion-plan';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'red',
      color: '#ff0000',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: false,
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
          ],
        },
      ],
    },
  ],
};
function prepared() {
  return {
    ok: true as const,
    project: createProject({ ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' }),
    job: JOB,
    jobOriginOffset: { x: 0, y: 0 },
  };
}
const machine = {
  statusReport: null,
  alarmCode: null,
  hasActiveStreamer: false,
  workOriginActive: false,
  wcoCache: null,
  trustedPositionEpoch: 4,
};
describe('Canvas Frame start', () => {
  it.each([false, true])(
    'maps the exact rotary Frame edge back to the surface (reverse=%s)',
    (reverseAxis) => {
      const source = prepared();
      const cut = JOB.groups[0]!;
      if (cut.kind !== 'cut') throw new Error('Expected cut fixture');
      const plan = buildCanvasMarkerPlan({
        prepared: {
          ...source,
          project: {
            ...source.project,
            device: {
              ...source.project.device,
              rotary: {
                enabled: true,
                type: 'chuck',
                objectDiameterMm: 60,
                mmPerRotation: 360,
                reverseAxis,
              },
            },
            startPoints: { frame: { edge: 1, fraction: 0.25 } },
          },
          job: {
            groups: [
              {
                ...cut,
                segments: [
                  {
                    closed: false,
                    polyline: [
                      { x: 10, y: 10 },
                      { x: 20, y: 20 },
                    ],
                  },
                ],
              },
            ],
          },
        },
        machine: { ...machine, wcoCache: { x: 100, y: 200, z: 0 } },
      });
      expect(plan.framePerimeter[0]?.x).toBeCloseTo(20);
      expect(plan.framePerimeter[0]?.y).toBeCloseTo(reverseAxis ? 17.5 : 12.5);
      expect(plan.framePerimeter.at(-1)).toEqual(plan.framePerimeter[0]);
    },
  );

  it('places the chosen Frame start on the physical motion envelope including entry travel', () => {
    const source = prepared();
    const cut = JOB.groups[0]!;
    if (cut.kind !== 'cut') throw new Error('Expected cut fixture');
    const plan = buildCanvasMarkerPlan({
      prepared: {
        ...source,
        project: { ...source.project, startPoints: { frame: { edge: 0, fraction: 0.5 } } },
        job: {
          groups: [
            {
              ...cut,
              entryRunwayMm: 5,
              segments: [
                {
                  closed: true,
                  polyline: [
                    { x: 10, y: 10 },
                    { x: 20, y: 10 },
                    { x: 20, y: 20 },
                    { x: 10, y: 20 },
                    { x: 10, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      },
      machine,
    });
    expect(plan.framePerimeter).toEqual([
      { x: 12.5, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 5, y: 20 },
      { x: 5, y: 10 },
      { x: 12.5, y: 10 },
    ]);
  });
});
