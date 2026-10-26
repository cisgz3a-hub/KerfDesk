// CNC reach review in Job Review, through the real Start preparation
// (prepareCurrentStartJob -> buildJobReviewModel), as audit F7 reproduced it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CncReachPoint } from '../../../core/cnc/cnc-reach-geometry';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import {
  defaultCncMachiningSetup,
  type CncSetupFixture,
} from '../../../core/scene/cnc-machining-setup';
import { cncProgramGeometry } from '../../../io/cnc/cnc-program-geometry';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { currentOutputScope } from '../../state/output-scope-state';
import { resetStore } from '../../state/test-helpers';
import { frameVerificationForProject } from '../frame-verification-testing';
import { prepareCurrentStartJob } from '../start-job-source';
import { buildJobReviewModel } from './job-review-model';

const EPOCH = 7;

function line(id: string, y: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: id + '.svg',
    bounds: { minX: 1, minY: y, maxX: 9, maxY: y },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 1, y },
              { x: 9, y },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...EMPTY_SCENE,
        // Two cuts 39 mm apart, so the rapid between them is long and above the stock.
        objects: [line('near-line', 1), line('far-line', 40)],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: null,
    },
    controllerSessionEpoch: EPOCH,
    controllerQualification: { kind: 'qualified', epoch: EPOCH, settings: 'verified' },
    controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
    controllerSettingsObservation: { sessionEpoch: EPOCH, observedAt: 1 },
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
  });
});

afterEach(() => {
  useLaserStore.setState(initialLaserState());
  resetStore();
});

async function prepareFramedStart() {
  // Frame-first (ADR-228): a recorded Frame for the exact current job is the Start gate.
  useLaserStore.setState({
    frameVerification: frameVerificationForProject(useStore.getState().project, {
      outputScope: currentOutputScope(useStore.getState()),
    }),
  });
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    useLaserStore.getState(),
    useCameraStore.getState(),
  );
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.messages.join(' / ')}`);
  return prepared;
}

async function reviewWarnings(): Promise<ReadonlyArray<string>> {
  const prepared = await prepareFramedStart();
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  return buildJobReviewModel({
    project: app.project,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    overrides: laser.ovCache,
    outputScope: currentOutputScope(app),
  }).warnings;
}

/** The first long rapid above the stock in the prepared program. */
async function firstLongTravel(): Promise<{
  readonly from: CncReachPoint;
  readonly to: CncReachPoint;
}> {
  const prepared = await prepareFramedStart();
  const sections = cncProgramGeometry(prepared.gcode, prepared.cncToolPlan).sections;
  for (const path of sections.flatMap((section) => section.paths))
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1],
        to = path[index];
      if (from === undefined || to === undefined || from.z <= 0 || to.z !== from.z) continue;
      if (Math.hypot(to.x - from.x, to.y - from.y) > 20) return { from, to };
    }
  throw new Error('The two-line CNC program has no long travel above the stock.');
}

function setFixtures(fixtures: ReadonlyArray<CncSetupFixture>): void {
  useStore.setState((state) => ({
    project: { ...state.project, cncSetup: { ...defaultCncMachiningSetup(), fixtures } },
  }));
}

describe('Job Review CNC reach review', () => {
  it('names a clamp that safe-Z travel crosses with a bit that has no flute length', async () => {
    // Audit F7-P2-1 (ADR-572 Amendment 1): the default 1/8" bit records no flute
    // length, and the clamp check used to skip its cutter entirely.
    const travel = await firstLongTravel();
    setFixtures([
      {
        id: 'clamp-1',
        name: 'Clamp 1',
        xMm: (travel.from.x + travel.to.x) / 2 - 1,
        yMm: (travel.from.y + travel.to.y) / 2 - 1,
        widthMm: 2,
        heightMm: 2,
        bottomZMm: 0,
        topZMm: travel.from.z + 10,
      },
    ]);

    const warnings = await reviewWarnings();

    expect(warnings).toContain(
      'CNC reach review · 3.175 mm (1/8") end mill: Cutter envelope intersects fixture Clamp 1 along the supplied path.',
    );
    expect(warnings).toContainEqual(
      expect.stringContaining("checked against the cutter's 3.175 mm width only"),
    );
  });

  it('adds no reach lines without fixtures or reach data on the job’s bit (audit F7-P3-1)', async () => {
    const warnings = await reviewWarnings();
    expect(warnings.filter((warning) => warning.startsWith('CNC reach review'))).toEqual([]);
  });
});
