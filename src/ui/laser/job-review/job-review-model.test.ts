import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { CNC_SETUP_ATTESTATION_PROMPT } from '../../state/cnc-setup-attestation';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { resetStore } from '../../state/test-helpers';
import { frameVerificationForProject } from '../frame-verification-testing';
import { LASER_MODE_UNVERIFIED_START_PROMPT } from '../laser-mode-start-acknowledgement';
import { prepareCurrentStartJob } from '../start-job-source';
import { buildJobReviewModel, type JobReviewModel } from './job-review-model';

const CONTROLLER_EPOCH = 7;

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
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

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(DEFAULT_DEVICE_PROFILE),
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
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

async function buildModelFromCurrentStores(): Promise<JobReviewModel> {
  // Frame-first (ADR-228): a recorded Frame for the exact current job is the
  // one Start gate; record it here so prepare succeeds for every arrangement.
  useLaserStore.setState({
    frameVerification: frameVerificationForProject(useStore.getState().project),
  });
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const camera = useCameraStore.getState();
  const prepared = await prepareCurrentStartJob(app, laser, camera);
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.messages.join(' / ')}`);
  return buildJobReviewModel({
    project: app.project,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
    overrides: laser.ovCache,
  });
}

describe('buildJobReviewModel', () => {
  it('summarizes a laser job from the exact prepared program', async () => {
    const model = await buildModelFromCurrentStores();

    expect(model.machineKind).toBe('laser');
    expect(model.stats.map((tile) => tile.label)).toEqual([
      'Estimated time',
      'Job size',
      'Operations',
      'G-code',
      'Origin',
    ]);
    expect(model.stats[1]?.value).toBe('8 × 8 mm');
    expect(model.stats[2]?.value).toBe('1 operation');
    expect(model.stats[2]?.detail).toBe('1 pass total');
    expect(model.stats[3]?.value).toMatch(/^[\d,]+ lines$/);
    // The origin tile is word-valued: it must ask for the text treatment.
    expect(model.stats[4]?.emphasis).toBe('text');
    expect(model.stats[4]?.value.length).toBeGreaterThan(0);
    expect(model.acknowledgement).toEqual({ kind: 'laser-verified' });
    expect(model.resolvedOriginLabel.length).toBeGreaterThan(0);
    expect(new Set(model.warnings).size).toBe(model.warnings.length);
  });

  it('carries the exact unverified-$32 prompt when laser mode is unknown', async () => {
    useLaserStore.setState((state) => ({
      controllerSettings: {
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
      },
      controllerSettingsObservation: {
        sessionEpoch: state.controllerSessionEpoch,
        observedAt: 2,
      },
      capabilities: { ...state.capabilities, settings: 'readonly-dump' },
    }));

    const model = await buildModelFromCurrentStores();

    expect(model.acknowledgement).toEqual({
      kind: 'laser-unverified',
      prompt: LASER_MODE_UNVERIFIED_START_PROMPT,
    });
  });

  it('puts exact Fill runway coverage in the always-visible stats row', async () => {
    const square: SceneObject = {
      kind: 'imported-svg',
      id: 'fill-square',
      source: 'fill.svg',
      bounds: { minX: 20, minY: 20, maxX: 24, maxY: 24 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 20, y: 20 },
                { x: 24, y: 20 },
                { x: 24, y: 24 },
                { x: 20, y: 24 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    };
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [square],
          layers: [
            {
              ...createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' }),
              hatchSpacingMm: 1,
              fillOverscanMm: 5,
              passes: 2,
            },
          ],
        },
      },
    }));

    const model = await buildModelFromCurrentStores();
    const runway = model.stats.find((tile) => tile.label === 'Fill runway');

    expect(runway?.value).toMatch(/^0 \/ \d+ full$/);
    expect(runway?.detail).toContain('Requested 5 mm');
    expect(runway?.detail).toMatch(/\d+ skipped/);
    expect(model.outputQualityFacts).toContainEqual(
      expect.objectContaining({ label: 'Fill runway coverage' }),
    );
  });

  it('keeps a reported $32=0 visible in Job Review', async () => {
    useLaserStore.setState({
      controllerSettings: {
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        minPowerS: DEFAULT_DEVICE_PROFILE.minPowerS,
        laserModeEnabled: false,
      },
    });

    const model = await buildModelFromCurrentStores();

    expect(model.warnings).toContainEqual(expect.stringContaining('$32=0'));
  });

  it('carries the M7 compatibility warning when a GRBL 1.1 program uses M7 air assist', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, airAssistCommand: 'M7' },
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer) => ({ ...layer, airAssist: true })),
        },
      },
    }));

    const model = await buildModelFromCurrentStores();

    expect(model.warnings).toContainEqual(expect.stringContaining('could not verify M7 support'));
    expect(model.acknowledgement).toEqual({
      kind: 'laser-unverified',
      prompt: LASER_MODE_UNVERIFIED_START_PROMPT,
    });
  });

  it('discloses manual air when the exact job requests air but emits no relay command', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer) => ({ ...layer, airAssist: true })),
        },
      },
    }));

    const model = await buildModelFromCurrentStores();

    expect(model.warnings).toContainEqual(expect.stringContaining('no M7/M8'));
    expect(model.warnings).toContainEqual(expect.stringContaining('manual air pump'));
  });

  it('summarizes a CNC job with the tool plan and the exact attestation prompt', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 12000, minPowerS: 0, laserModeEnabled: false },
      ovCache: { feed: 100, rapid: 100, spindle: 100 },
      accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
      workZReferenceEpoch: CONTROLLER_EPOCH,
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: CONTROLLER_EPOCH,
        toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      },
    });

    const model = await buildModelFromCurrentStores();

    expect(model.machineKind).toBe('cnc');
    expect(model.stats[2]?.label).toBe('Cutters');
    expect(model.stats[2]?.value).toBe('1 bit');
    expect(model.stats[2]?.detail).toBe('0 tool changes');
    expect(model.toolPlanLabels).toEqual(['1. 3.175 mm (1/8") end mill']);
    expect(model.acknowledgement).toEqual({
      kind: 'cnc',
      prompt: CNC_SETUP_ATTESTATION_PROMPT,
    });
  });
});
