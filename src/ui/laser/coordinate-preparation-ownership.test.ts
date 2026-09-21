import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import { nativeBedCaptureFrameKey } from '../state/native-bed-frame';
import { resetStore } from '../state/test-helpers';
import { createFramedRunPermit } from '../state/framed-run';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useToastStore } from '../state/toast-store';
import { ownCurrentStartPreparation } from './start-preparation-owner';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { prepareStartJob } from './start-job-readiness';
import { dispatchLaserSecondPassFrame } from './use-frame-action';
import { currentPrintCutOutputRegistration } from './print-cut-output';

const originalFrame = useLaserStore.getState().frame;
const owners: ReturnType<typeof ownCurrentStartPreparation>[] = [];

function project() {
  const base = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    bedWidth: 358,
    bedHeight: 268,
    homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
  });
  return {
    ...base,
    scene: {
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'native.svg',
          bounds: { minX: 50, minY: 228, maxX: 60, maxY: 238 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 50, y: 238 },
                    { x: 60, y: 228 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function installMachine(known: boolean) {
  const evidence = stockNativeEvidence(useStore.getState().project.device);
  useLaserStore.setState({
    ...initialLaserState(),
    ...evidence,
    controllerBuildInfoObservation: known ? evidence.controllerBuildInfoObservation : null,
    controllerSettingsObservation: known ? evidence.controllerSettingsObservation : null,
    activeWcs: 'G54',
    wcoCache: { x: 0, y: 0, z: 0 },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: -308, y: -238, z: 0 },
      wPos: { x: -308, y: -238, z: 0 },
      wco: { x: 0, y: 0, z: 0 },
      feed: 0,
      spindle: 0,
    },
  });
  return evidence;
}

function preparedBundle(laser = useLaserStore.getState()) {
  const app = useStore.getState();
  const machine = { ...laser, connected: false, alarmCode: null, hasActiveStreamer: false };
  const prepared = prepareStartJob(
    app.project,
    laser.controllerSettings,
    machine,
    app.jobPlacement,
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  return {
    app,
    project: app.project,
    laser,
    prepared,
    laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
  };
}

function own(resolved?: Parameters<typeof ownCurrentStartPreparation>[3]) {
  const owner = ownCurrentStartPreparation(
    useStore.getState(),
    useLaserStore.getState(),
    undefined,
    resolved,
  );
  owners.push(owner);
  return owner;
}

beforeEach(() => {
  resetStore();
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useStore.setState({
    project: project(),
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
  });
});
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  useLaserStore.setState({ frame: originalFrame });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('coordinate evidence owns async preparation without becoming a new Start gate', () => {
  it('cancels old Absolute work when a same-session observation establishes native bed mapping', () => {
    const evidence = installMachine(false);
    const old = useLaserStore.getState();
    const before = preparedBundle(old);
    const owner = own();
    useLaserStore.setState(evidence);
    const after = preparedBundle();
    expect(before.prepared.gcode).toContain('X50.000 Y30.000');
    expect(after.prepared.gcode).toContain('X-308.000 Y-238.000');
    expect(useLaserStore.getState().statusReport).toBe(old.statusReport);
    expect(useLaserStore.getState().wcoCache).toBe(old.wcoCache);
    expect(owner.signal.aborted).toBe(true);
    expect(owner.inputsChanged()).toBe(true);
    // A completed Frame owns sealed bytes, so its ordinary Start contract is
    // unchanged by this pre-Frame generation check.
    expect(
      controllerStartPreparationStillCurrent(old, useLaserStore.getState(), {
        ignoreAdvisoryControllerEvidence: true,
      }),
    ).toBe(true);
  });

  it('keeps $30/$32 and equivalent $I/settings observation replacements advisory', () => {
    const evidence = installMachine(true);
    const owner = own();
    useLaserStore.setState({
      controllerSettings: {
        ...evidence.controllerSettings,
        maxPowerS: 2000,
        laserModeEnabled: false,
      },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
      controllerBuildInfo: { ...evidence.controllerBuildInfo, userInfo: 'updated description' },
      controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 2 },
    });
    expect(owner.signal.aborted).toBe(false);
    expect(owner.inputsChanged()).toBe(false);
  });

  it('uses the resolved Verified Origin instead of the unrelated live Absolute selector', () => {
    const evidence = installMachine(false);
    useLaserStore.setState({ workOriginActive: true });
    const owner = own({
      resolvedJobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
    });
    useLaserStore.setState(evidence);
    expect(owner.signal.aborted).toBe(false);
  });

  it.each([false, true])(
    'retains registered placement identity when mapping was known=%s',
    (known) => {
      const evidence = installMachine(known);
      useLaserStore.setState({ workOriginActive: true });
      const original = useStore.getState().project;
      const registered = {
        ...original,
        printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
      };
      useStore.setState({ project: registered });
      useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
      const laser = useLaserStore.getState();
      const frameKey = nativeBedCaptureFrameKey(registered.device, laser);
      usePrintCutSessionStore
        .getState()
        .capture('first', { x: 20, y: 30 }, laser.trustedPositionEpoch ?? 0, frameKey);
      usePrintCutSessionStore
        .getState()
        .capture('second', { x: 30, y: 30 }, laser.trustedPositionEpoch ?? 0, frameKey);
      expect(currentPrintCutOutputRegistration(registered)).toMatchObject({
        translation: { x: 20, y: 30 },
      });
      const owner = own({
        resolvedJobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' },
      });
      useLaserStore.setState({
        ...evidence,
        controllerSettings: {
          ...evidence.controllerSettings,
          maxPowerS: 2000,
          laserModeEnabled: false,
        },
      });
      // Verified placement's envelope remains null in both states; registration
      // still expires if its captured physical coordinate frame changes.
      expect(owner.signal.aborted).toBe(!known);
      expect(currentPrintCutOutputRegistration(registered) === null).toBe(!known);
    },
  );

  it('refuses a stale Frame handoff after mapping changes, even after the owner settled', async () => {
    const evidence = installMachine(false);
    const bundle = preparedBundle();
    const frame = vi.fn(async () => undefined);
    useLaserStore.setState({ ...evidence, frame });
    await expect(dispatchLaserSecondPassFrame(bundle, DEFAULT_OUTPUT_SCOPE)).resolves.toBeNull();
    expect(frame).not.toHaveBeenCalled();
  });

  it('accepts Frame handoff after an advisory refresh and preserves the exact prepared bytes', async () => {
    const evidence = installMachine(true);
    const bundle = preparedBundle();
    const frame = vi.fn<typeof originalFrame>(async (_bounds, _feed, candidate) => {
      if (candidate === undefined) throw new Error('missing candidate');
      expect(candidate.preparedStart).toBe(bundle.prepared);
      useLaserStore.setState((laser) => ({ framedRun: createFramedRunPermit(candidate, laser) }));
    });
    useLaserStore.setState({
      frame,
      controllerSettings: {
        ...evidence.controllerSettings,
        maxPowerS: 2000,
        laserModeEnabled: false,
      },
      controllerSettingsObservation: { sessionEpoch: 7, observedAt: 2 },
    });
    const permit = await dispatchLaserSecondPassFrame(bundle, DEFAULT_OUTPUT_SCOPE);
    expect(permit?.candidate.preparedStart.gcode).toBe(bundle.prepared.gcode);
    expect(frame).toHaveBeenCalledOnce();
  });
});
