import { describe, expect, it } from 'vitest';
import { computeJobBounds, frameBoundsSignature, machineSpaceJob } from '../../core/job';
import type { RotarySetup, RotaryType } from '../../core/devices';
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

// Code quality verification C2, E4-P3-4: ADR-695 Amendment 5 leaves the Z work
// offset out of this check only for a job whose rotary turns on Z. On every
// other job Z is a real reference (CNC cut depth, a laser's focus), and on a
// Z rotary X and Y still place the job.
describe('the Frame-first check and the Z work offset', () => {
  const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const FRAMED = { x: 20, y: 30, z: 0 };
  const CHUCK = { enabled: true, type: 'chuck', mmPerRotation: 40, objectDiameterMm: 60 } as const;

  function issueAfter(rotary: RotarySetup | undefined, live: { x: number; y: number; z: number }) {
    const base = rotaryProject('chuck');
    const { rotary: _chuck, ...flatBed } = base.device;
    void _chuck;
    const project = { ...base, device: rotary === undefined ? flatBed : { ...flatBed, rotary } };
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('Expected prepared output');
    return requiredFrameIssueFromPrepared({
      prepared,
      measuredFrameBounds: BOUNDS,
      machine: {
        wcoCache: live,
        workOriginActive: true,
        frameVerification: {
          boundsSignature: frameBoundsSignature(BOUNDS),
          wco: FRAMED,
          workOriginActive: true,
        },
      },
    });
  }

  it.each<[string, RotarySetup | undefined]>([
    ['no rotary', undefined],
    [
      'a Z rotary that is switched off',
      { ...CHUCK, enabled: false, axis: 'Z', axisConfirmed: 'Z' },
    ],
    ['a Y rotary', CHUCK],
    ['an A rotary', { ...CHUCK, axis: 'A', axisConfirmed: 'A' }],
  ])('refuses a Z-only offset change on %s', (_name, rotary) => {
    expect(issueAfter(rotary, FRAMED)).toBeNull();
    expect(issueAfter(rotary, { ...FRAMED, z: 3 })).toContain('completed Frame');
  });

  describe('on a Z rotary', () => {
    const Z_ROTARY: RotarySetup = { ...CHUCK, axis: 'Z', axisConfirmed: 'Z' };

    it('accepts the Z offset the Frame’s own G92 Z0 left', () => {
      expect(issueAfter(Z_ROTARY, { ...FRAMED, z: 3 })).toBeNull();
    });

    it.each([
      ['X', { ...FRAMED, x: 21 }],
      ['Y', { ...FRAMED, y: 31 }],
    ])('refuses a change of the %s offset alone', (_axis, live) => {
      expect(issueAfter(Z_ROTARY, live)).toContain('completed Frame');
    });
  });
});
