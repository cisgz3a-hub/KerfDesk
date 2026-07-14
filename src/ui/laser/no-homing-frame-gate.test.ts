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

function verification(input: Project): FrameVerification {
  const prepared = prepareOutput(input, {
    jobOrigin: {
      startFrom: 'current-position',
      anchor: 'center',
      currentPosition: headPosition,
    },
  });
  if (!prepared.ok) throw new Error('test setup: prepareOutput failed');
  const bounds = computeJobBounds(prepared.job);
  if (bounds === null) throw new Error('test setup: no bounds');
  return { boundsSignature: frameBoundsSignature(bounds), wco: null, workOriginActive: false };
}

function machine(
  position: { readonly x: number; readonly y: number },
  frame: FrameVerification | null,
) {
  return {
    statusReport: { ...idleStatus, mPos: { ...position, z: 0 } },
    alarmCode: null,
    hasActiveStreamer: false,
    frameVerification: frame,
  };
}

describe('no-homing relative Frame gate (ADR-192)', () => {
  it('blocks Current Position Start before Frame', () => {
    const result = prepareStartJob(
      project(),
      readyController,
      machine(headPosition, null),
      currentPosition,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.messages.join('\n')).toMatch(/no-homing placement needs a Frame/i);
  });

  it('allows Start after a matching Frame and re-blocks after a jog', () => {
    const input = project();
    const frame = verification(input);
    expect(
      prepareStartJob(input, readyController, machine(headPosition, frame), currentPosition).ok,
    ).toBe(true);
    expect(
      prepareStartJob(input, readyController, machine({ x: 130, y: 80 }, frame), currentPosition)
        .ok,
    ).toBe(false);
  });
});
