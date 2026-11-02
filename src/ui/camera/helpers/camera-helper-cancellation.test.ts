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
import { saveLastCameraSource, savePreferredCameraId } from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import type { LiveCanvasRun } from '../../state/canvas-motion-plan';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { AFTER_SETTLE_MS } from '../job-watch/job-watch-runner';
import { cancelOverlayCapture, captureOverlayStill } from '../capture-overlay-still';
import { startRememberedCamera } from './auto-start';
import { useCameraHelpersStore } from './camera-helpers-store';
import { installCameraHelpers } from './install-camera-helpers';
import { scheduleAfterJobRefresh } from './schedule-after-job-refresh';

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
    registerFrameSource: async () => ({ kind: 'ok', frameUrl: 'http://bridge.invalid/frame' }),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('pending automatic camera starts', () => {
  it('starts a remembered USB device when enumeration fills the initial empty selection', async () => {
    saveLastCameraSource('usb');
    savePreferredCameraId('overhead');
    useCameraStore.setState({ selectedDeviceId: null });
    const camera = usbCamera(['overhead']);
    await startRememberedCamera({ camera, bridge: undefined, bridgeAvailable: false });
    expect(camera.openStream).toHaveBeenCalledExactlyOnceWith('overhead');
    expect(useCameraStore.getState().sourceState.kind).toBe('live');
  });
  it.each(['stop', 'off-on', 'selection', 'abort'] as const)(
    'does not open USB after %s during discovery',
    async (action) => {
      saveLastCameraSource('usb');
      savePreferredCameraId('overhead');
      const listing = deferred<Array<{ deviceId: string; label: string }>>();
      const camera = { ...usbCamera(['overhead']), listCameras: () => listing.promise };
      const owner = new AbortController();
      const pending = startRememberedCamera(
        { camera, bridge: undefined, bridgeAvailable: false },
        owner.signal,
      );
      if (action === 'stop') useCameraStore.getState().stopSource();
      if (action === 'selection') useCameraStore.getState().selectCamera('other');
      if (action === 'abort') owner.abort();
      if (action === 'off-on') {
        useCameraHelpersStore.getState().setSettings({ autoStart: false });
        useCameraHelpersStore.getState().setSettings({ autoStart: true });
      }
      listing.resolve([{ deviceId: 'overhead', label: 'overhead' }]);
      await pending;
      expect(camera.openStream).not.toHaveBeenCalled();
      expect(useCameraStore.getState().sourceState.kind).toBe('idle');
      // Cancelling a helper does not disable an explicit subsequent start.
      await useCameraStore.getState().startUsbSource(camera);
      expect(camera.openStream).toHaveBeenCalledOnce();
    },
  );

  it.each(['stop', 'off-on'] as const)(
    'does not activate the machine camera after %s',
    async (action) => {
      saveLastCameraSource('machine');
      const discovery = deferred<MachineCameraDiscovery>();
      const machine = { ...bridge(found), discoverMachineCamera: () => discovery.promise };
      const pending = startRememberedCamera({
        camera: undefined,
        bridge: machine,
        bridgeAvailable: true,
      });
      if (action === 'stop') useCameraStore.getState().stopSource();
      else {
        useCameraHelpersStore.getState().setSettings({ autoStart: false });
        useCameraHelpersStore.getState().setSettings({ autoStart: true });
      }
      discovery.resolve(found);
      await pending;
      expect(useCameraStore.getState().machineCamera.kind).toBe('found');
      expect(useCameraStore.getState().sourceState.kind).toBe('idle');
    },
  );

  it('cancels discovery when the installed helpers are disposed', async () => {
    calibrate();
    saveLastCameraSource('usb');
    savePreferredCameraId('overhead');
    const listing = deferred<Array<{ deviceId: string; label: string }>>();
    const camera = { ...usbCamera(['overhead']), listCameras: () => listing.promise };
    const stop = installCameraHelpers({ camera, bridge: undefined, bridgeAvailable: false });
    stop();
    listing.resolve([{ deviceId: 'overhead', label: 'overhead' }]);
    await listing.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(camera.openStream).not.toHaveBeenCalled();
  });
});

function queueRefresh(visible = true): () => void {
  vi.useFakeTimers();
  calibrate();
  useCameraStore.setState({
    sourceState: { kind: 'live', source: machineSource },
    overlayStill: { ...frame },
    overlayVisible: visible,
    placementActive: visible,
  });
  const plan = {} as LiveCanvasRun['plan'];
  useLaserStore.setState({ liveCanvasRun: run('finished', plan) });
  return scheduleAfterJobRefresh(plan, AFTER_SETTLE_MS);
}

describe('the after-job settling delay', () => {
  it.each([
    'exit',
    'hide-show',
    'live',
    'new-picture',
    'new-job',
    'document',
    'device',
    'off-on',
    'stop',
  ] as const)('retires the old refresh on %s before it captures', async (action) => {
    const stop = queueRefresh();
    try {
      const camera = useCameraStore.getState();
      if (action === 'exit') camera.deactivatePlacement();
      if (action === 'hide-show') {
        camera.setOverlayVisible(false);
        camera.setOverlayVisible(true);
      }
      if (action === 'live') camera.setOverlayStill(null);
      if (action === 'new-picture') camera.setOverlayStill({ ...frame });
      if (action === 'new-job') useLaserStore.setState({ liveCanvasRun: run('running', {}) });
      if (action === 'document')
        useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
      if (action === 'device')
        useStore.getState().updateDeviceProfile({ name: 'Changed camera context' });
      if (action === 'off-on') {
        useCameraHelpersStore.getState().setSettings({ refreshAfterJob: false });
        useCameraHelpersStore.getState().setSettings({ refreshAfterJob: true });
      }
      if (action === 'stop') camera.stopSource();
      await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
      expect(capture).not.toHaveBeenCalled();
      if (action === 'exit')
        expect(useCameraStore.getState()).toMatchObject({
          overlayVisible: false,
          placementActive: false,
        });
    } finally {
      stop();
    }
  });

  it('still refreshes once for the unchanged finished job', async () => {
    const stop = queueRefresh();
    try {
      await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
      expect(capture).toHaveBeenCalledExactlyOnceWith(machineSource);
      expect(useCameraStore.getState().overlayStill).toBe(frame);
    } finally {
      stop();
    }
  });

  it('keeps an already hidden picture eligible when no new intent occurs', async () => {
    const stop = queueRefresh(false);
    try {
      await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
      expect(capture).toHaveBeenCalledExactlyOnceWith(machineSource);
      expect(useCameraStore.getState()).toMatchObject({
        overlayStill: frame,
        overlayVisible: true,
        placementActive: true,
      });
    } finally {
      stop();
    }
  });

  it('cancels a queued refresh for an explicit exit even when already hidden', async () => {
    const stop = queueRefresh(false);
    try {
      cancelOverlayCapture();
      useCameraStore.getState().deactivatePlacement();
      await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
      expect(capture).not.toHaveBeenCalled();
      expect(useCameraStore.getState().placementActive).toBe(false);
    } finally {
      stop();
    }
  });

  it('does not supersede a newer manual capture still awaiting its frame', async () => {
    const stop = queueRefresh();
    const nextFrame = deferred<typeof frame>();
    const manual = captureOverlayStill(() => nextFrame.promise);
    try {
      await vi.advanceTimersByTimeAsync(AFTER_SETTLE_MS);
      expect(capture).not.toHaveBeenCalled();
      nextFrame.resolve(frame);
      expect(await manual).toBe('captured');
    } finally {
      nextFrame.resolve(frame);
      stop();
    }
  });
});
