import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import { FLUIDNC_GCODE_MAX_PAYLOAD_BYTES } from '../../../core/controllers/fluidnc/fluidnc-line-limit';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { createLayer, createProject, EMPTY_SCENE } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { captureLaserModeStartSnapshot } from '../../state/laser-mode-start-evidence';
import { resetStore, svgObj } from '../../state/test-helpers';
import { captureStartExternalEnvironment } from '../start-job-external-environment';
import { prepareCurrentStartJob } from '../start-job-source';
import {
  FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX,
  FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX,
  FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX,
} from './fluidnc-divergence-warnings';
import { runJobReviewGate } from './job-review-gate';
import { useJobReviewStore } from './job-review-store';
import { captureJobReviewModels } from './testing';

const LONG_SENDABLE_LINE = 'G1 X'.padEnd(FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1, '0');
const IDLE_STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function configureProject(controllerKind: 'fluidnc' | 'grbl-v1.1'): void {
  const project = {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind },
    scene: {
      ...EMPTY_SCENE,
      objects: [svgObj('line', ['#ff0000'])],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  useStore.setState({ project });
}

async function openReviewWithLongLine(): Promise<{
  readonly review: ReturnType<typeof runJobReviewGate>;
  readonly capture: ReturnType<typeof captureJobReviewModels>;
}> {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const externalEnvironment = captureStartExternalEnvironment(app.project);
  const prepared = await prepareCurrentStartJob(
    app,
    laser,
    useCameraStore.getState(),
    externalEnvironment.rotaryRasterAllowed,
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(`Preparation failed: ${prepared.messages.join(' / ')}`);
  const capture = captureJobReviewModels();
  const review = runJobReviewGate({
    initial: {
      app,
      project: app.project,
      laser,
      prepared: { ...prepared, gcode: LONG_SENDABLE_LINE },
      laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      externalEnvironment,
    },
    checkpointToReplace: null,
    completedReceipt: null,
    purpose: 'start',
  });
  await vi.waitFor(() => expect(capture.models).toHaveLength(1));
  return { review, capture };
}

beforeEach(() => {
  resetStore();
  useJobReviewStore.getState().close();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: IDLE_STATUS,
  });
});

afterEach(async () => {
  useJobReviewStore.getState().cancel();
  useJobReviewStore.getState().close();
  useLaserStore.setState(initialLaserState());
  await Promise.resolve();
});

describe('FluidNC Job Review disclosure wiring', () => {
  it('keeps configured-only FluidNC as an identity disclosure without claiming the live long line is rejected', async () => {
    configureProject('fluidnc');
    useLaserStore.setState({
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    });
    const { review, capture } = await openReviewWithLongLine();
    const warnings = capture.models[0]?.warnings.join('\n') ?? '';

    expect(warnings).toContain(FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX);
    expect(warnings).not.toContain(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX);

    useJobReviewStore.getState().cancel();
    await review;
    capture.stop();
  });

  it.each([
    ['active', 'fluidnc', 'fluidnc', FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX],
    ['detected', 'grbl-v1.1', 'fluidnc', FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX],
  ] as const)(
    'shows the real long-line disclosure when FluidNC is %s',
    async (_source, activeControllerKind, detectedControllerKind, identityWarningPrefix) => {
      configureProject('grbl-v1.1');
      useLaserStore.setState({ activeControllerKind, detectedControllerKind });
      const { review, capture } = await openReviewWithLongLine();
      const warnings = capture.models[0]?.warnings.join('\n') ?? '';

      expect(warnings).toContain(FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX);
      expect(warnings).toContain(`at ${FLUIDNC_GCODE_MAX_PAYLOAD_BYTES + 1} characters`);
      expect(warnings).toContain(identityWarningPrefix);

      useJobReviewStore.getState().cancel();
      await review;
      capture.stop();
    },
  );
});
