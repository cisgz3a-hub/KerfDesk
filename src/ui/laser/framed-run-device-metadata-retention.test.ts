import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';
import { prepareCurrentStartJob } from './start-job-source';

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
      ...createProject(DEFAULT_DEVICE_PROFILE),
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
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 3,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: {
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
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
    ['coordinate origin', { origin: 'rear-right' }],
  ])('still expires the permit when %s evidence changes', async (_field, patch) => {
    const permit = await installReviewPendingFramedRunPermitForCurrentState();
    const before = useStore.getState().project;
    useStore.setState({ project: { ...before, device: { ...before.device, ...patch } } });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
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
    if (_field === 'output power' || _field === 'coordinate origin') {
      expect(rebuilt.gcode).not.toBe(framed.gcode);
    } else {
      expect(rebuilt.gcode).toBe(framed.gcode);
      if (_field === 'no-go warning') {
        expect(framed.warnings.join('\n')).not.toContain('Clamp');
        expect(rebuilt.warnings.join('\n')).toContain('no-go zone "Clamp"');
      } else {
        expect(rebuilt.metrics).not.toEqual(framed.metrics);
        expect(rebuilt.jobTimingPlan).not.toEqual(framed.jobTimingPlan);
      }
    }
  });
});
