// The camera helpers (ADR-663 Amendment 1): the camera used last starts by
// itself, never in place of another or over one already running; a calibrated
// camera starts with the laser; a held picture is taken again after a job; and
// Alt+C refreshes the picture, starting the camera first when it must.

import type * as FrameSource from '../frame-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import type {
  CameraAdapter,
  CameraBridgeAdapter,
  CameraStream,
  MachineCameraDiscovery,
} from '../../../platform/types';
import { useStore } from '../../state';
import {
  loadLastCameraSource,
  saveLastCameraSource,
  savePreferredCameraId,
} from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import type { LiveCanvasRun } from '../../state/canvas-motion-plan';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { AFTER_SETTLE_MS } from '../job-watch/job-watch-runner';
import { startRememberedCamera } from './auto-start';
import { useCameraHelpersStore } from './camera-helpers-store';
import { installCameraHelpers, MOVED_CHECK_SETTLE_MS } from './install-camera-helpers';
import { refreshCameraPicture, refreshCameraPictureFromKey } from './refresh-picture';

const capture = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));

const initialCamera = useCameraStore.getState();
const initialLaser = useLaserStore.getState();
const CAMERA_URL = 'http://192.168.10.1/frame.jpg';
const frame = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(128) };

function bridge(discovery: MachineCameraDiscovery): CameraBridgeAdapter {
  return {
    isSupported: () => true,
    probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'none' }),
    rtspStreamStatus: async () => ({ kind: 'live' }),
    discoverMachineCamera: vi.fn(async () => discovery),
    proxiedFrameUrl: () => 'http://bridge.invalid/frame',
    health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
  };
}
const found: MachineCameraDiscovery = {
  kind: 'found',
  cameraUrl: CAMERA_URL,
  proxyFrameUrl: 'http://bridge.invalid/frame',
};

function usbCamera(devices: ReadonlyArray<string>): CameraAdapter & {
  readonly openStream: ReturnType<typeof vi.fn<CameraAdapter['openStream']>>;
} {
  const stream = (sourceId: string): CameraStream => ({
    stream: {} as MediaStream,
    sourceId,
    resizeMode: 'none',
    stop: vi.fn(),
  });
  return {
    isSupported: () => true,
    listCameras: async () => devices.map((deviceId) => ({ deviceId, label: deviceId })),
    openStream: vi.fn(async (deviceId?: string) => stream(deviceId ?? devices[0] ?? '')),
    discoverNetworkCamera: async () => null,
  };
}

const machineSource = {
  kind: 'machine-jpeg' as const,
  cameraUrl: CAMERA_URL,
  frameUrl: 'http://bridge.invalid/frame',
};

function calibrate(): void {
  useStore.getState().updateDeviceProfile({ cameraModel: savedCameraModel() });
}

function run(lifecycle: LiveCanvasRun['lifecycle'], plan: object): LiveCanvasRun {
  return { plan, lifecycle, startedAtMs: 1 } as unknown as LiveCanvasRun;
}

beforeEach(() => {
  localStorage.clear();
  resetStore();
  capture.mockReset();
  capture.mockResolvedValue(frame);
  useCameraStore.setState(initialCamera);
  useLaserStore.setState(initialLaser);
  useCameraHelpersStore.setState({ settings: { autoStart: true, refreshAfterJob: true } });
});

afterEach(() => {
  vi.useRealTimers();
  useCameraStore.getState().stopSource();
  useCameraStore.setState(initialCamera);
  useLaserStore.setState(initialLaser);
});

describe('starting the camera used last', () => {
  it("finds the laser's own camera through the bridge and starts it", async () => {
    saveLastCameraSource('machine');
    await startRememberedCamera({
      camera: undefined,
      bridge: bridge(found),
      bridgeAvailable: true,
    });
    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'live',
      source: machineSource,
    });
  });

  it('starts the USB camera that ran last, and never another one in its place', async () => {
    saveLastCameraSource('usb');
    savePreferredCameraId('overhead');
    const laptopOnly = usbCamera(['laptop']);
    await startRememberedCamera({ camera: laptopOnly, bridge: undefined, bridgeAvailable: false });
    expect(laptopOnly.openStream).not.toHaveBeenCalled();
    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
    const both = usbCamera(['laptop', 'overhead']);
    await startRememberedCamera({ camera: both, bridge: undefined, bridgeAvailable: false });
    expect(both.openStream).toHaveBeenCalledWith('overhead');
    expect(useCameraStore.getState().sourceState.kind).toBe('live');
  });

  it('does nothing when switched off, with no camera remembered, or over a camera already running', async () => {
    const machine = bridge(found);
    const deps = { camera: undefined, bridge: machine, bridgeAvailable: true };
    await startRememberedCamera(deps);
    expect(machine.discoverMachineCamera).not.toHaveBeenCalled();
    saveLastCameraSource('machine');
    useCameraHelpersStore.getState().setSettings({ autoStart: false });
    await startRememberedCamera(deps);
    expect(machine.discoverMachineCamera).not.toHaveBeenCalled();
    useCameraHelpersStore.getState().setSettings({ autoStart: true });
    useCameraStore.setState({
      sourceState: { kind: 'error', sourceKind: 'usb', message: 'Camera unplugged.' },
    });
    await startRememberedCamera(deps);
    expect(machine.discoverMachineCamera).not.toHaveBeenCalled();
    expect(useCameraStore.getState().sourceState.kind).toBe('error');
  });

  it('stays quiet when the laser camera is not there', async () => {
    saveLastCameraSource('machine');
    await startRememberedCamera({
      camera: undefined,
      bridge: bridge({ kind: 'not-found' }),
      bridgeAvailable: true,
    });
    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
    expect(useCameraStore.getState().machineCamera.kind).toBe('not-found');
  });
});

describe('the installed helpers', () => {
  it('remember the camera that runs, and start a calibrated one when the laser connects', async () => {
    const machine = bridge(found);
    const stop = installCameraHelpers({
      camera: undefined,
      bridge: machine,
      bridgeAvailable: true,
    });
    useCameraStore.setState({ machineCamera: { ...found, kind: 'found' } });
    useCameraStore.getState().activateMachineCamera();
    expect(loadLastCameraSource()).toBe('machine');
    useCameraStore.getState().stopSource();
    useCameraStore.setState({ machineCamera: { kind: 'not-found' } });
    calibrate();
    // Calibrating starts the camera by itself; stop it to see the laser do it.
    await vi.waitFor(() => expect(useCameraStore.getState().sourceState.kind).toBe('live'));
    useCameraStore.getState().stopSource();
    useCameraStore.setState({ machineCamera: { kind: 'not-found' } });
    useLaserStore.setState({ connection: { kind: 'connected' } } as never);
    await vi.waitFor(() =>
      expect(useCameraStore.getState().sourceState).toMatchObject({
        kind: 'live',
        source: machineSource,
      }),
    );
    stop();
  });

  it('take the held picture again once a job finishes and the head has settled', async () => {
    vi.useFakeTimers();
    calibrate();
    const stop = installCameraHelpers({
      camera: undefined,
      bridge: undefined,
      bridgeAvailable: false,
    });
    useCameraStore.setState({ sourceState: { kind: 'live', source: machineSource } });
    const old = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    useCameraStore.getState().setOverlayStill(old);
    const plan = {};
    useLaserStore.setState({ liveCanvasRun: run('running', plan) });
    useLaserStore.setState({ liveCanvasRun: run('finished', plan) });
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
    expect(capture).toHaveBeenCalledWith(machineSource);
    expect(useCameraStore.getState().overlayStill).toBe(frame);
    stop();
  });

  it('leave a live picture alone after a job, and respect the switch', async () => {
    vi.useFakeTimers();
    calibrate();
    const stop = installCameraHelpers({
      camera: undefined,
      bridge: undefined,
      bridgeAvailable: false,
    });
    useCameraStore.setState({ sourceState: { kind: 'live', source: machineSource } });
    // The moved check takes its one picture of a camera that has just started.
    await vi.advanceTimersByTimeAsync(MOVED_CHECK_SETTLE_MS);
    capture.mockClear();
    useLaserStore.setState({ liveCanvasRun: run('finished', {}) });
    await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
    expect(capture).not.toHaveBeenCalled();
    expect(useCameraStore.getState().overlayStill).toBeNull();
    const held = { ...frame };
    useCameraStore.getState().setOverlayStill(held);
    useCameraHelpersStore.getState().setSettings({ refreshAfterJob: false });
    useLaserStore.setState({ liveCanvasRun: run('finished', {}) });
    await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
    expect(capture).not.toHaveBeenCalled();
    expect(useCameraStore.getState().overlayStill).toBe(held);
    stop();
  });
});

describe('refreshing the picture', () => {
  it('says why it could not, and shows a new held picture when it can', async () => {
    expect(await refreshCameraPicture()).toBe('no-camera');
    useCameraStore.setState({
      sourceState: { kind: 'live', source: machineSource },
      overlayVisible: false,
    });
    expect(await refreshCameraPicture()).toBe('not-calibrated');
    calibrate();
    expect(await refreshCameraPicture()).toBe('refreshed');
    expect(useCameraStore.getState()).toMatchObject({
      overlayStill: frame,
      overlayVisible: true,
      placementActive: true,
    });
    capture.mockResolvedValueOnce(null);
    expect(await refreshCameraPicture()).toBe('failed');
  });

  it('Alt+C opens the panel to start the camera, then refreshes once it runs', async () => {
    calibrate();
    const stop = installCameraHelpers({
      camera: undefined,
      bridge: undefined,
      bridgeAvailable: false,
    });
    refreshCameraPictureFromKey();
    expect(useCameraStore.getState().panelOpen).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    useCameraStore.setState({ sourceState: { kind: 'live', source: machineSource } });
    await vi.waitFor(() => expect(useCameraStore.getState().overlayStill).toBe(frame));
    stop();
  });
});
