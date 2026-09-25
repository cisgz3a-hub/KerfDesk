import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { checkProjectMinimumFeatures } from '../../../core/min-feature';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { currentOutputScope } from '../../state/output-scope-state';
import { useCameraStore } from '../../state/camera-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { resetStore } from '../../state/test-helpers';
import { frameVerificationForProject } from '../frame-verification-testing';
import { prepareCurrentStartJob } from '../start-job-source';
import { buildJobReviewModel } from './job-review-model';
import {
  detectMinFeatureWarnings,
  formatFeatureMm,
  minFeatureWarnings,
} from './min-feature-warnings';

const CONTROLLER_EPOCH = 7;

// A device without a laser head profile, so the kerf comes from the operation.
const { laserSubProfile: _head, ...HEADLESS_DEVICE } = DEFAULT_DEVICE_PROFILE;

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function stencil(bridgeMm: number): SceneObject {
  const holes = [0, 1, 2, 3].map((i) => rectangle(15 + i * (10 + bridgeMm), 15, 10, 10));
  return {
    kind: 'imported-svg',
    id: 'stencil',
    source: 'stencil.svg',
    bounds: { minX: 10, minY: 10, maxX: 80, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [rectangle(10, 10, 70, 20), ...holes] }],
  };
}

function project(object: SceneObject, layer: Partial<Layer>): Project {
  return {
    ...createProject(HEADLESS_DEVICE),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'red', color: '#ff0000' }), name: 'Cut', ...layer }],
    },
  };
}

describe('minFeatureWarnings', () => {
  it('names the layer, count, kerf, narrowest width and where it is', () => {
    const reports = checkProjectMinimumFeatures(
      project(stencil(0.1), { mode: 'line', kerfOffsetMm: 0.075 }),
    );
    const warnings = minFeatureWarnings(reports);
    expect(warnings).toHaveLength(1);
    const [warning] = warnings;
    expect(warning).toContain('Layer "Cut": 3 parts narrower than the 0.15 mm kerf');
    expect(warning).toContain('(twice its Kerf Offset)');
    expect(warning).toContain('narrowest 0.1 mm at X ');
    expect(warning).toContain('; also at ');
  });

  it('says the kerf is assumed when nothing sets it', () => {
    const reports = checkProjectMinimumFeatures(project(stencil(0.1), { mode: 'line' }));
    expect(minFeatureWarnings(reports)[0]).toContain(
      'the 0.15 mm kerf (assumed; set Kerf Offset to half your measured kerf)',
    );
  });

  it('warns about nothing for wide bridges or for a Fill operation', () => {
    expect(
      detectMinFeatureWarnings(project(stencil(0.3), { mode: 'line', kerfOffsetMm: 0.075 })),
    ).toEqual([]);
    expect(detectMinFeatureWarnings(project(stencil(0.1), { mode: 'fill' }))).toEqual([]);
  });

  it('says which layers were only partly checked', () => {
    const reports = checkProjectMinimumFeatures(project(stencil(0.1), { mode: 'line' }), {
      budget: { maxPieces: 10, maxPairTests: 10 },
    });
    expect(minFeatureWarnings(reports).at(-1)).toMatch(/^Layer "Cut" was only partly checked/);
  });

  it('reuses the result for the same prepared project', () => {
    const prepared = project(stencil(0.1), { mode: 'line' });
    expect(detectMinFeatureWarnings(prepared)).toBe(detectMinFeatureWarnings(prepared));
  });

  it('formats feature widths to the hundredth', () => {
    expect(formatFeatureMm(0.1)).toBe('0.1');
    expect(formatFeatureMm(0.125)).toBe('0.13');
    expect(formatFeatureMm(3)).toBe('3');
    expect(formatFeatureMm(0.0001)).toBe('under 0.01');
  });
});

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

describe('Job Review minimum-feature warnings', () => {
  beforeEach(() => {
    resetStore();
    useLaserStore.setState({
      ...initialLaserState(),
      connection: { kind: 'connected' },
      statusReport: idleStatus,
      controllerSessionEpoch: CONTROLLER_EPOCH,
      controllerQualification: { kind: 'qualified', epoch: CONTROLLER_EPOCH, settings: 'verified' },
      controllerSettings: {
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
        laserModeEnabled: true,
      },
      controllerSettingsObservation: { sessionEpoch: CONTROLLER_EPOCH, observedAt: 1 },
    });
  });

  afterEach(() => {
    useLaserStore.setState(initialLaserState());
    resetStore();
  });

  it('lists sub-kerf bridges as a warning, never a refusal', async () => {
    useStore.setState({
      project: project(stencil(0.1), { mode: 'line', kerfOffsetMm: 0.075 }),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    });
    useLaserStore.setState({
      frameVerification: frameVerificationForProject(useStore.getState().project),
    });
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const prepared = await prepareCurrentStartJob(app, laser, useCameraStore.getState());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const model = buildJobReviewModel({
      project: app.project,
      prepared,
      laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      overrides: laser.ovCache,
      outputScope: currentOutputScope(app),
    });
    expect(model.warnings.some((w) => w.startsWith('Layer "Cut": 3 parts narrower'))).toBe(true);
  });
});
