import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  LASER_MACHINE_CONFIG,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { resetStore } from '../state/test-helpers';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { prepareCurrentStartJob } from './start-job-source';
import { initDeviceSetup, machineSetupProfile } from './device-setup/device-setup-flow';

const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'metadata-retention-line',
  source: 'metadata-retention-line.svg',
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 10, y: 20 },
            { x: 110, y: 20 },
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
      ...createProject({
        ...DEFAULT_DEVICE_PROFILE,
        homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
      }),
      scene: {
        ...EMPTY_SCENE,
        objects: [lineObject],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  useCameraStore.setState({
    placementActive: false,
    confirmedPositionEpoch: null,
    surfaceHeightMm: 0,
  });
  const evidence = stockNativeEvidence(useStore.getState().project.device, true);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 3,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: {
      ...evidence.controllerSettings,
      reportInches: false,
    },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
  });
  ensureFramedRunInvalidationSubscriptions();
});

afterEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
});

describe('completed Frame retention across descriptive device metadata', () => {
  it('retains Frame when Machine Setup saves the same device with reordered property keys', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: LASER_MACHINE_CONFIG,
        device: {
          ...state.project.device,
          capabilities: [...(state.project.device.capabilities ?? []), 'laser-output'],
        },
      },
    }));
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const before = useStore.getState().project;
    const draft = initDeviceSetup(before.device, null, {
      machine: before.machine ?? LASER_MACHINE_CONFIG,
    });
    const saved = machineSetupProfile(draft);
    expect(saved).toEqual(before.device);
    expect(Object.keys(saved)).not.toEqual(Object.keys(before.device));

    useStore.getState().replaceMachineSetup(saved, draft.draftMachine, draft.cncDraft);
    expect(useStore.getState().project.scene).toBe(before.scene);
    expect(useStore.getState().project.machine).toEqual(before.machine);
    expect(useLaserStore.getState().completedFrame).toBe(permit);
    expect(useLaserStore.getState().frameVerification).toBe(permit.candidate.frameVerification);
    const rebuilt = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!rebuilt.ok) throw new Error(rebuilt.messages.join(' '));
    expect(rebuilt.metrics.frameJobBounds).toEqual(
      permit.candidate.preparedStart.metrics.frameJobBounds,
    );
    expect(rebuilt.metrics.frameMotionBounds).toEqual(
      permit.candidate.preparedStart.metrics.frameMotionBounds,
    );
    expect(rebuilt.gcode).toBe(permit.candidate.preparedStart.gcode);
  });

  it('retains the implicit Laser Frame when Wizard Save adds its output label and advisory values', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const before = useStore.getState().project;
    expect(before.machine).toBeUndefined();
    expect(before.device.capabilities).not.toContain('laser-output');
    const draft = initDeviceSetup(before.device, null, { machine: LASER_MACHINE_CONFIG });
    const saved = machineSetupProfile({
      ...draft,
      draft: {
        ...draft.draft,
        estimateCutTimeScale: 2,
        estimateTravelTimeScale: 2,
        noGoZones: [
          { id: 'clamp', name: 'Clamp', enabled: true, x: 45, y: 375, width: 20, height: 10 },
        ],
      },
    });
    expect(saved.capabilities).toContain('laser-output');
    useStore.getState().replaceMachineSetup(saved, draft.draftMachine, draft.cncDraft);
    expect(useStore.getState().project.machine).toEqual(LASER_MACHINE_CONFIG);
    expect(useLaserStore.getState().completedFrame).toBe(permit);

    const rebuilt = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!rebuilt.ok) throw new Error(rebuilt.messages.join(' '));
    expect(rebuilt.gcode).toBe(permit.candidate.preparedStart.gcode);
    expect(rebuilt.metrics.frameMotionBounds).toEqual(
      permit.candidate.preparedStart.metrics.frameMotionBounds,
    );
    expect(rebuilt.metrics).not.toEqual(permit.candidate.preparedStart.metrics);
    expect(rebuilt.warnings.join('\n')).toContain('no-go zone "Clamp"');
  });

  it.each<[string, Partial<DeviceProfile>]>([
    ['name', { name: 'Operator-renamed profile' }],
    ['vendor', { vendor: 'Operator vendor note' }],
    ['model', { model: 'Operator model note' }],
    ['profileSource', { profileSource: 'imported' }],
    ['catalogVersion', { catalogVersion: '2099-01-01' }],
    [
      'evidence',
      {
        evidence: [
          { label: 'Advisory note', status: 'user-imported', note: 'Descriptive evidence only.' },
        ],
      },
    ],
  ])('keeps the exact permit and prepared facts when %s changes', async (_field, patch) => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const before = useStore.getState().project;
    const framed = permit.candidate.preparedStart;
    expect(framed.jobTimingPlan?.kind).toBe('ok');
    useStore.setState({ project: { ...before, device: { ...before.device, ...patch } } });

    expect(useLaserStore.getState().framedRun).toBe(permit);
    expect(useLaserStore.getState().frameVerification).toBe(permit.candidate.frameVerification);
    expect(permit.candidate.project).toBe(before);
    expect(permit.candidate.preparedStart).toBe(framed);
    const rebuilt = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!rebuilt.ok) throw new Error(rebuilt.messages.join(' '));
    expect(rebuilt.canvasPlan.retentionKey).toBe(permit.candidate.executionSignature);
    expect(rebuilt.gcode).toBe(framed.gcode);
    expect(rebuilt.canvasPlan.manifest).toEqual(framed.canvasPlan.manifest);
    expect(rebuilt.canvasPlan.framePerimeter).toEqual(framed.canvasPlan.framePerimeter);
    expect(rebuilt.warnings).toEqual(framed.warnings);
    expect(rebuilt.metrics).toEqual(framed.metrics);
    expect(rebuilt.jobTimingPlan).toEqual(framed.jobTimingPlan);
  });

  it.each<[string, Partial<DeviceProfile>]>([
    ['cut calibration', { estimateCutTimeScale: 2 }],
    ['travel calibration', { estimateTravelTimeScale: 3 }],
    [
      'no-go warning',
      {
        noGoZones: [
          { id: 'clamp', name: 'Clamp', enabled: true, x: 45, y: 375, width: 20, height: 10 },
        ],
      },
    ],
    ['output power', { maxPowerS: 2000 }],
    ['minimum power', { minPowerS: 10 }],
    ['framing feed', { framingFeedMmPerMin: 3000 }],
    ['corner timing', { junctionDeviationMm: 0.04 }],
    ['air command', { airAssistCommand: 'M8' }],
    ['air restart strategy', { airAssistRestartUnreliable: true }],
    ['controlled tool-off feed', { controlledLaserOffTravelFeedMmPerMin: 800 }],
    ['laser-mode profile hint', { laserModeEnabled: false }],
    ['autofocus button command', { autofocusCommand: 'G30' }],
    ['Fire button configuration', { fireControl: { enabled: true, maxPowerPercent: 3 } }],
  ])(
    'retains spatial Frame and refreshes exact preparation when %s changes',
    async (_field, patch) => {
      const permit = await installReviewPendingFramedRunPermitForCurrentState();
      const before = useStore.getState().project;
      useStore.setState({ project: { ...before, device: { ...before.device, ...patch } } });
      expect(useLaserStore.getState().framedRun).toBe(permit);
      expect(useLaserStore.getState().completedFrame).toBe(permit);
      expect(useLaserStore.getState().frameVerification).toBe(permit.candidate.frameVerification);
      const rebuilt = await prepareCurrentStartJob(
        useStore.getState(),
        useLaserStore.getState(),
        useCameraStore.getState(),
        undefined,
        false,
      );
      if (!rebuilt.ok) throw new Error(rebuilt.messages.join(' '));
      const framed = permit.candidate.preparedStart;
      expect(rebuilt.canvasPlan.retentionKey).not.toBe(permit.candidate.executionSignature);
      expect(rebuilt.metrics.frameJobBounds).toEqual(framed.metrics.frameJobBounds);
      expect(rebuilt.metrics.frameMotionBounds).toEqual(framed.metrics.frameMotionBounds);
      if (_field === 'output power' || _field === 'controlled tool-off feed') {
        expect(rebuilt.gcode).not.toBe(framed.gcode);
      } else {
        expect(rebuilt.gcode).toBe(framed.gcode);
        if (_field === 'no-go warning') {
          expect(framed.warnings.join('\n')).not.toContain('Clamp');
          expect(rebuilt.warnings.join('\n')).toContain('no-go zone "Clamp"');
        } else if (_field === 'cut calibration' || _field === 'travel calibration') {
          expect(rebuilt.metrics).not.toEqual(framed.metrics);
          expect(rebuilt.jobTimingPlan).not.toEqual(framed.jobTimingPlan);
        }
      }
    },
  );

  it('still expires Frame after the physical coordinate origin changes', async () => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    useStore.setState((state) => ({
      project: { ...state.project, device: { ...state.project.device, origin: 'rear-right' } },
    }));
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    const rebuilt = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!rebuilt.ok) throw new Error(rebuilt.messages.join(' '));
    expect(rebuilt.canvasPlan.retentionKey).not.toBe(permit.candidate.executionSignature);
    expect(rebuilt.gcode).not.toBe(permit.candidate.preparedStart.gcode);
  });
});
