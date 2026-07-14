import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareStartJob } from './start-job-readiness';

const IDLE_AT_ENTRY: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 50, y: 5, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('Start no-go entry path', () => {
  it('blocks the entry move from the live head position through a no-go zone', () => {
    const result = prepareStartJob(
      guardedProject(),
      {
        maxPowerS: 1000,
        minPowerS: 0,
        laserModeEnabled: true,
      },
      {
        statusReport: IDLE_AT_ENTRY,
        alarmCode: null,
        hasActiveStreamer: false,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages).toContain('Line 8: motion crosses no-go zone "Clamp".');
    }
  });
});

function guardedProject(): Project {
  const base = createProject();
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'entry-path',
    source: 'entry-path.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  return {
    ...base,
    device: {
      ...base.device,
      noGoZones: [
        { id: 'clamp', name: 'Clamp', enabled: true, x: 35, y: 80, width: 10, height: 40 },
      ],
    },
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}
