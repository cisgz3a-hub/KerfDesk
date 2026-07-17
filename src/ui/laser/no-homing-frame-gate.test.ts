// Frame-first (ADR-228): a completed Frame for the exact current job is the
// ONLY Start policy gate, for every placement mode — including Current
// Position on a no-homing machine. The head position is baked into a
// current-position compile, so the recorded Frame stops matching after a jog
// and Start blocks until a fresh watched trace.
import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type { JobPlacementSettings } from '../job-placement';
import type { FrameVerification } from '../state/frame-verification';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const readyController = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const headPosition = { x: 120, y: 80 };
const currentPosition: JobPlacementSettings = {
  startFrom: 'current-position',
  anchor: 'center',
};
const object: SceneObject = {
  kind: 'traced-image',
  id: 'trace',
  source: 'logo.png',
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
  transform: { ...IDENTITY_TRANSFORM, x: 175, y: 185 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 30 },
            { x: 0, y: 30 },
          ],
        },
      ],
    },
  ],
};

function project(): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: false } },
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

type HeadPosition = { readonly x: number; readonly y: number };

function machine(position: HeadPosition, frameVerification: FrameVerification | null = null) {
  return {
    statusReport: { ...idleStatus, mPos: { ...position, z: 0 } },
    alarmCode: null,
    hasActiveStreamer: false,
    frameVerification,
  };
}

// Mirrors dispatchFrameIfSafe's recording (use-frame-action.ts): every
// dispatched Frame stores the compiled job's bounds signature plus the origin
// identity at that moment (no custom origin on this machine, so wco null).
function framedAt(position: HeadPosition): FrameVerification {
  const prepared = prepareOutput(project(), {
    jobOrigin: { startFrom: 'current-position', anchor: 'center', currentPosition: position },
  });
  if (!prepared.ok) throw new Error('fixture compile failed');
  const bounds = computeJobBounds(prepared.job, prepared.project.device);
  if (bounds === null) throw new Error('fixture job has no bounds');
  return { boundsSignature: frameBoundsSignature(bounds), wco: null, workOriginActive: false };
}

describe('no-homing relative Frame policy (frame-first, ADR-228)', () => {
  it('blocks Current Position Start until a Frame is completed for this exact job', () => {
    const result = prepareStartJob(
      project(),
      readyController,
      machine(headPosition),
      currentPosition,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toEqual([frameVerificationBlockedMessage()]);
    }
  });

  it('opens Current Position Start once a Frame is recorded at this head position', () => {
    const result = prepareStartJob(
      project(),
      readyController,
      machine(headPosition, framedAt(headPosition)),
      currentPosition,
    );
    expect(result.ok).toBe(true);
  });

  it('a jog after the Frame invalidates it — Start blocks until a fresh trace', () => {
    const jogged = { x: 130, y: 80 };
    const result = prepareStartJob(
      project(),
      readyController,
      machine(jogged, framedAt(headPosition)),
      currentPosition,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toEqual([frameVerificationBlockedMessage()]);
    }
  });
});
