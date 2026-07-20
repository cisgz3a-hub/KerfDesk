import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { frameVerificationForProject } from './frame-verification-testing';
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

const readyController = {
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
};

describe('Frame verification laser motion envelope', () => {
  it('rejects a proof recorded before Fill overscan increased from 0 to 5 mm', () => {
    const framed = fillProject({ fillOverscanMm: 0 });
    const changed = fillProject({ fillOverscanMm: 5 });

    expectStartNeedsFreshFrame(changed, frameVerificationForProject(framed));
  });

  it.each([2, -2])('rejects a proof when the reverse-row offset changes to %s mm', (offsetMm) => {
    const framed = fillProject({ bidirectionalScanOffsetMm: 0 });
    const changed = fillProject({ bidirectionalScanOffsetMm: offsetMm });

    expectStartNeedsFreshFrame(changed, frameVerificationForProject(framed));
  });

  it('rejects a proof when enabling reverse rows activates a calibrated offset', () => {
    const framed = fillProject({ fillBidirectional: false, bidirectionalScanOffsetMm: 2 });
    const changed = fillProject({ fillBidirectional: true, bidirectionalScanOffsetMm: 2 });

    expectStartNeedsFreshFrame(changed, frameVerificationForProject(framed));
  });
});

function expectStartNeedsFreshFrame(
  project: Project,
  frameVerification: ReturnType<typeof frameVerificationForProject>,
): void {
  const result = prepareStartJob(project, readyController, {
    ...readyMachine,
    frameVerification,
  });

  expect(result).toEqual({ ok: false, messages: [frameVerificationBlockedMessage()] });
}

function fillProject(overrides: Partial<Layer>): Project {
  const layer: Layer = {
    ...createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' }),
    fillStyle: 'scanline',
    fillOverscanMm: 0,
    hatchSpacingMm: 1,
    fillBidirectional: true,
    allowUncalibratedBidirectionalScan: true,
    bidirectionalScanOffsetMm: 0,
    power: 10,
    ...overrides,
  };
  return {
    ...createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE),
    scene: {
      ...EMPTY_SCENE,
      objects: [fillObject],
      layers: [layer],
    },
  };
}

const fillObject: SceneObject = {
  kind: 'imported-svg',
  id: 'fill-shape',
  source: 'fill.svg',
  bounds: { minX: 100, minY: 100, maxX: 110, maxY: 110 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 100, y: 100 },
            { x: 110, y: 100 },
            { x: 110, y: 110 },
            { x: 100, y: 110 },
            { x: 100, y: 100 },
          ],
        },
      ],
    },
  ],
};
