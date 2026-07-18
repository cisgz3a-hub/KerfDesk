import { describe, expect, it } from 'vitest';
import { computeJobBounds, frameBoundsSignature, machineSpaceJob } from '../../core/job';
import type { RotaryType } from '../../core/devices';
import { createLayer, createProject, EMPTY_SCENE, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { requiredFrameIssueFromPrepared } from './required-frame-readiness';

function rotaryProject(type: RotaryType) {
  const base = createProject();
  return {
    ...base,
    device: {
      ...base.device,
      rotary: {
        enabled: true,
        type,
        mmPerRotation: 360,
        objectDiameterMm: 60,
      },
    },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'O1',
          source: 'required-frame-rotary.svg',
          bounds: { minX: 4, minY: 6, maxX: 24, maxY: 16 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 4, y: 6 },
                    { x: 24, y: 16 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('required Frame rotary compatibility', () => {
  it.each(['roller', 'chuck'] as const)(
    'accepts only the emitted machine-space signature for an active %s rotary',
    (type) => {
      const prepared = prepareOutput(rotaryProject(type));
      if (!prepared.ok) throw new Error('Expected prepared rotary output');
      const machineJob = machineSpaceJob(
        prepared.job,
        prepared.project.device,
        prepared.project.machine,
      );
      const machineBounds = computeJobBounds(machineJob, prepared.project.device);
      const surfaceBounds = computeJobBounds(prepared.job, prepared.project.device);
      if (machineBounds === null || surfaceBounds === null) {
        throw new Error('Expected rotary job bounds');
      }
      const common = { wcoCache: null, workOriginActive: false } as const;

      expect(
        requiredFrameIssueFromPrepared({
          prepared,
          machine: {
            ...common,
            frameVerification: {
              boundsSignature: frameBoundsSignature(machineBounds),
              wco: null,
              workOriginActive: false,
            },
          },
        }),
      ).toBeNull();
      expect(frameBoundsSignature(surfaceBounds)).not.toBe(frameBoundsSignature(machineBounds));
      expect(
        requiredFrameIssueFromPrepared({
          prepared,
          machine: {
            ...common,
            frameVerification: {
              boundsSignature: frameBoundsSignature(surfaceBounds),
              wco: null,
              workOriginActive: false,
            },
          },
        }),
      ).toContain('completed Frame');
    },
  );
});
