import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { frameVerificationForProject } from './frame-verification-testing';
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

describe('prepareStartJob output scope', () => {
  it('starts only selected artwork when Cut Selected Graphics is enabled', () => {
    const project = twoLineProject();
    const scope = selectedScope(['B']);
    const result = prepareStartJob(
      project,
      readyController,
      {
        ...readyMachine,
        // Frame-first (ADR-228): the Frame must cover the scoped compile.
        frameVerification: frameVerificationForProject(project, { outputScope: scope }),
      },
      undefined,
      scope,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X120');
      expect(result.gcode).not.toContain('X10');
    }
  });

  it('re-blocks when selection-origin mode changes after Frame', () => {
    const project = twoLineProject();
    const framedScope = selectedScope(['B'], false);
    const changedScope = selectedScope(['B'], true);
    const placement = { startFrom: 'user-origin' as const, anchor: 'front-left' as const };
    const wco = { x: 0, y: 0, z: 0 };
    const result = prepareStartJob(
      project,
      readyController,
      {
        ...readyMachine,
        workOriginActive: true,
        wcoCache: wco,
        frameVerification: frameVerificationForProject(project, {
          jobOrigin: placement,
          outputScope: framedScope,
          wco,
          workOriginActive: true,
        }),
      },
      placement,
      changedScope,
    );

    expect(result).toEqual({ ok: false, messages: [frameVerificationBlockedMessage()] });
  });

  it('re-blocks when a selected-only Frame is reused for the full canvas', () => {
    const project = twoLineProject();
    const framedScope = selectedScope(['B']);
    const result = prepareStartJob(project, readyController, {
      ...readyMachine,
      frameVerification: frameVerificationForProject(project, { outputScope: framedScope }),
    });

    expect(result).toEqual({ ok: false, messages: [frameVerificationBlockedMessage()] });
  });
});

function twoLineProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject('A', 10), lineObject('B', 120)],
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
    },
  };
}

function lineObject(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function selectedScope(
  selectedObjectIds: ReadonlyArray<string>,
  useSelectionOrigin = false,
): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin,
    selectedObjectIds,
  };
}
