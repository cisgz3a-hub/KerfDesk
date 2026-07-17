import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { frameVerificationForProject } from './frame-verification-testing';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

const controller = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const readyMachine = { statusReport: idleStatus, alarmCode: null, hasActiveStreamer: false };

function homingProject(): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: true } },
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

// Frame-first (2026-07-17): homing state never gates Start. The one policy
// gate is a completed Frame for the exact job; with it, an unhomed Absolute
// start proceeds.
describe('Start gating for Absolute Coordinates', () => {
  it('requires only a completed Frame — not homing — on a homing-capable laser', () => {
    const project = homingProject();
    const blocked = prepareStartJob(project, controller, {
      ...readyMachine,
      homingState: 'unknown',
    });
    expect(blocked).toEqual({ ok: false, messages: [frameVerificationBlockedMessage()] });

    const framed = prepareStartJob(project, controller, {
      ...readyMachine,
      homingState: 'unknown',
      frameVerification: frameVerificationForProject(project),
    });
    expect(framed.ok).toBe(true);
  });

  it('keeps Current Position available without homing — only the frame gate remains', () => {
    const result = prepareStartJob(
      homingProject(),
      controller,
      { ...readyMachine, homingState: 'unknown' },
      { startFrom: 'current-position', anchor: 'front-left' },
    );

    expect(result).toEqual({ ok: false, messages: [frameVerificationBlockedMessage()] });
  });
});
