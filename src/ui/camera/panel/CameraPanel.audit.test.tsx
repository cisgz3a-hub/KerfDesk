import { act } from 'react';
import type * as FrameSource from '../frame-source';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CameraAdapter,
  CameraBridgeAdapter,
  CameraStream,
  PlatformAdapter,
} from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../../image-editor/control-audit-test-support';
import { useCameraStore as camera } from '../../state/camera-store';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { useTutorialStore } from '../../tutorials/tutorial-store';
import { useJobWatchStore } from '../job-watch/job-watch-store';
import { useCameraCalibrationStore } from '../calibrate/camera-calibration-store';
import { CameraPanel } from './CameraPanel';
import { CameraDiagnostics } from './CameraDiagnostics';
import { UsbCameraSection } from './UsbCameraSection';
import { RtspSourceControls } from './RtspSourceControls';
import { MachineCameraSection } from './MachineCameraSection';
import { SnapshotControls } from './SnapshotControls';

const capture = vi.hoisted(() => vi.fn());
const snapshot = vi.hoisted(() => vi.fn());
vi.mock('../frame-source', async (original) => ({
  ...(await original<typeof FrameSource>()),
  captureSourceFrame: capture,
}));
vi.mock('../snapshot', () => ({ saveCameraSnapshot: snapshot }));
vi.mock('../CameraSourceView', () => ({ CameraSourceView: () => null }));
const initial = camera.getState();
const live = {
  kind: 'machine-jpeg' as const,
  cameraUrl: 'http://camera.invalid/frame',
  frameUrl: 'http://bridge.invalid/frame',
};
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => false, requestPort: async () => null },
};
const wrap = (node: React.ReactNode, adapter = platform) => (
  <PlatformProvider adapter={adapter}>{node}</PlatformProvider>
);
beforeEach(() => {
  resetStore();
  camera.setState(initial);
  capture.mockReset();
  snapshot.mockReset();
  useCameraCalibrationStore.getState().closeWizard();
  localStorage.clear();
});
afterEach(() => {
  camera.getState().stopSource();
  camera.setState(initial);
  vi.restoreAllMocks();
});

it('opens the camera lesson, persists the larger panel preference and closes the panel', async () => {
  camera.setState({ panelOpen: true, machineCamera: { kind: 'not-found' } });
  const host = await mountControl(wrap(<CameraPanel />));
  await clickControl(host, 'Tutorial: Camera');
  expect(useTutorialStore.getState().tutorialId).toBe('camera');
  const dialog = host.querySelector<HTMLElement>('[aria-label="Camera preview"]')!;
  expect(dialog.style.width).toBe('320px');
  // The larger monitoring view is chosen on the settings page (ADR-663).
  await clickControl(host, 'Camera settings');
  expect(host.textContent).toContain('Camera settings');
  await clickControl(host, 'Larger view');
  expect(dialog.style.width).toBe('560px');
  await clickControl(host, 'Compact view');
  expect(dialog.style.width).toBe('320px');
  await clickControl(host, 'Back to the camera');
  expect(control(host, 'Camera settings')).toBeTruthy();
  await clickControl(host, 'Close camera panel');
  expect(camera.getState().panelOpen).toBe(false);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('opens the guided camera setup from the panel at the camera choice', async () => {
  camera.setState({ panelOpen: true, machineCamera: { kind: 'not-found' } });
  const host = await mountControl(wrap(<CameraPanel />));
  expect(host.textContent).toContain('Set up your camera');
  await clickControl(host, 'Set up camera');
  expect(useCameraCalibrationStore.getState()).toMatchObject({
    open: true,
    mode: 'calibrate',
    step: { kind: 'camera' },
  });
  expect(document.body.textContent).toContain('Which camera should KerfDesk use?');
  expect(control(document.body, 'Next').disabled).toBe(true);
});

it('keeps a running camera when the panel closes while the calibrated overlay shows it', async () => {
  const stop = vi.fn();
  const usb = {
    kind: 'usb' as const,
    stream: { stream: {} as MediaStream, sourceId: 'audit-usb', resizeMode: 'none' as const, stop },
  };
  useStore.getState().updateDeviceProfile({ cameraModel: savedCameraModel() });
  camera.setState({
    panelOpen: true,
    machineCamera: { kind: 'not-found' },
    sourceState: { kind: 'live', source: usb },
    overlayVisible: true,
  });
  const host = await mountControl(wrap(<CameraPanel />));
  await clickControl(host, 'Close camera panel');
  expect(camera.getState().sourceState.kind).toBe('live');
  expect(stop).not.toHaveBeenCalled();
});

it('starts USB through the adapter, reports denial, starts a fake stream and stops it', async () => {
  const stop = vi.fn();
  const stream: CameraStream = {
    stream: {} as MediaStream,
    sourceId: 'audit-usb',
    resizeMode: 'none',
    stop,
  };
  const openStream = vi
    .fn<CameraAdapter['openStream']>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(stream);
  const adapter: CameraAdapter = {
    isSupported: () => true,
    listCameras: async () => [],
    openStream,
    discoverNetworkCamera: async () => null,
  };
  const host = await mountControl(wrap(<UsbCameraSection camera={adapter} />));
  await clickControl(host, 'Start USB camera');
  expect(openStream).toHaveBeenCalledTimes(1);
  expect(camera.getState().sourceState.kind).toBe('denied');
  expect(host.textContent).toContain('Camera access was blocked');
  expect(host.textContent).toContain('let desktop apps use the camera');
  await clickControl(host, 'Start USB camera');
  expect(camera.getState().sourceState).toMatchObject({ kind: 'live', source: { kind: 'usb' } });
  await clickControl(host, 'Stop camera');
  expect(camera.getState().sourceState.kind).toBe('idle');
  expect(stop).toHaveBeenCalledTimes(1);
});

it('opens RTSP details and connects the entered URL through a fake bridge before stopping', async () => {
  let completeProbe: () => void = () => undefined;
  const probe = vi.fn<CameraBridgeAdapter['probeRtspCamera']>().mockImplementation(
    () =>
      new Promise((resolve) => {
        completeProbe = () =>
          resolve({
            kind: 'ok',
            url: 'rtsp://camera.invalid/live',
            ffmpegAvailable: true,
            previewUrl: 'http://bridge.invalid/preview',
          });
      }),
  );
  const startRtspSource = vi.spyOn(camera.getState(), 'startRtspSource');
  const bridge: CameraBridgeAdapter = {
    isSupported: () => true,
    probeRtspCamera: probe,
    rtspStreamStatus: async () => ({ kind: 'live' }),
    discoverMachineCamera: async () => ({ kind: 'not-found' }),
    registerFrameSource: async () => ({ kind: 'ok', frameUrl: 'http://bridge.invalid/frame' }),
    health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
  };
  const host = await mountControl(
    wrap(<RtspSourceControls />, { ...platform, cameraBridge: bridge }),
  );
  await clickElement(host.querySelector('summary'));
  expect(host.querySelector('details')?.open).toBe(true);
  expect(control(host, 'Connect').disabled).toBe(true);
  const input = host.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    input.value = 'rtsp://camera.invalid/live';
    Simulate.change(input);
  });
  await clickControl(host, 'Connect');
  expect(probe).toHaveBeenCalledWith({ url: 'rtsp://camera.invalid/live' });
  expect(camera.getState().sourceState).toEqual({
    kind: 'starting',
    sourceKind: 'machine-rtsp',
  });
  expect(control(host, 'Connecting…').disabled).toBe(true);
  await act(async () => {
    completeProbe();
    // The click handler intentionally returns void; await the real action,
    // including its asynchronous Web Crypto resource fingerprint.
    await startRtspSource.mock.results[0]?.value;
  });
  expect(camera.getState().sourceState).toMatchObject({
    kind: 'live',
    source: { kind: 'machine-rtsp' },
  });
  await clickControl(host, 'Stop');
  expect(camera.getState().sourceState.kind).toBe('idle');
});

it('dispatches machine discovery, activates the found camera and disables an already active source', async () => {
  const detect = vi.fn();
  const found = { kind: 'found' as const, cameraUrl: live.cameraUrl, proxyFrameUrl: live.frameUrl };
  camera.setState({ machineCamera: found });
  const host = await mountControl(<MachineCameraSection state={found} onDetect={detect} />);
  await clickControl(host, 'Detect machine camera');
  expect(detect).toHaveBeenCalledTimes(1);
  await clickControl(host, 'Use this camera');
  expect(camera.getState().sourceState).toEqual({ kind: 'live', source: live });
  expect(control(host, 'In use').disabled).toBe(true);
  const pending = await mountControl(
    <MachineCameraSection state={{ kind: 'detecting' }} onDetect={detect} />,
  );
  expect(control(pending, 'Detecting…').disabled).toBe(true);
});

it('opens Diagnostics, gates idle capture and reports both readable pixels and capture failure', async () => {
  const host = await mountControl(wrap(<CameraDiagnostics />));
  await clickElement(host.querySelector('summary'));
  expect(host.querySelector('details')?.open).toBe(true);
  expect(control(host, 'Test capture').disabled).toBe(true);
  await act(async () => camera.setState({ sourceState: { kind: 'live', source: live } }));
  capture.mockResolvedValueOnce({ width: 12, height: 8, data: new Uint8ClampedArray(384) });
  await clickControl(host, 'Test capture');
  expect(capture).toHaveBeenLastCalledWith(live);
  expect(host.textContent).toContain('Captured 12×8 — pixels readable.');
  capture.mockResolvedValueOnce(null);
  await clickControl(host, 'Test capture');
  expect(host.textContent).toContain('Capture FAILED');
});

it('gates idle snapshot, passes the live source and platform to save, and dispatches size changes', async () => {
  const onToggleWide = vi.fn();
  const host = await mountControl(
    wrap(<SnapshotControls wide={false} onToggleWide={onToggleWide} />),
  );
  expect(control(host, 'Save snapshot…').disabled).toBe(true);
  await act(async () => camera.setState({ sourceState: { kind: 'live', source: live } }));
  snapshot.mockResolvedValue('saved');
  await clickControl(host, 'Save snapshot…');
  expect(snapshot).toHaveBeenCalledWith(live, platform);
  await clickControl(host, 'Larger view');
  expect(onToggleWide).toHaveBeenCalledTimes(1);
});

// The everyday view (ADR-663): one Start for the camera this computer would pick.
it("starts the laser's own camera from the preview card when the bridge found it", async () => {
  const found = { kind: 'found' as const, cameraUrl: live.cameraUrl, proxyFrameUrl: live.frameUrl };
  camera.setState({ panelOpen: true, machineCamera: found });
  const host = await mountControl(wrap(<CameraPanel />));
  expect(host.textContent).toContain("Laser's built-in camera");
  await clickControl(host, 'Use this camera');
  expect(camera.getState().sourceState).toEqual({ kind: 'live', source: live });
  expect(host.textContent).toContain("Laser's built-in camera");
  await clickControl(host, 'Stop');
  expect(camera.getState().sourceState.kind).toBe('idle');
});

it('starts the chosen USB camera from the preview card and names it', async () => {
  const stream: CameraStream = {
    stream: {} as MediaStream,
    sourceId: 'audit-usb',
    resizeMode: 'none',
    stop: vi.fn(),
  };
  const adapter: CameraAdapter = {
    isSupported: () => true,
    listCameras: async () => [{ deviceId: 'overhead', label: 'Overhead webcam' }],
    openStream: vi.fn<CameraAdapter['openStream']>().mockResolvedValue(stream),
    discoverNetworkCamera: async () => null,
  };
  camera.setState({ panelOpen: true, machineCamera: { kind: 'not-found' } });
  const host = await mountControl(wrap(<CameraPanel />, { ...platform, camera: adapter }));
  expect(host.textContent).toContain('Camera off');
  await clickControl(host, 'Start camera');
  expect(adapter.openStream).toHaveBeenCalledTimes(1);
  expect(camera.getState().sourceState).toMatchObject({ kind: 'live', source: { kind: 'usb' } });
  expect(host.textContent).toContain('Overhead webcam');
});

it('shows the bed-picture controls instead of the setup once the running camera is calibrated', async () => {
  useStore.getState().updateDeviceProfile({ cameraModel: savedCameraModel() });
  camera.setState({ panelOpen: true, machineCamera: { kind: 'not-found' } });
  const host = await mountControl(wrap(<CameraPanel />));
  expect(host.textContent).not.toContain('Set up your camera');
  expect(control(host, 'Refresh picture')).toBeTruthy();
  expect(host.textContent).toContain('Show on canvas');
  expect(host.textContent).toContain('Fill blanks');
  expect(host.textContent).toContain('Watch the job');
  await clickControl(host, 'Camera settings');
  expect(control(host, 'Recalibrate…')).toBeTruthy();
  expect(control(host, 'Check camera…')).toBeTruthy();
});

it('keeps Watch the job open while one of its choices is ticked', async () => {
  const before = useJobWatchStore.getState().settings;
  camera.setState({ panelOpen: true, machineCamera: { kind: 'not-found' } });
  const closed = await mountControl(wrap(<CameraPanel />));
  expect(watchFold(closed)?.open).toBe(false);
  await act(async () => useJobWatchStore.getState().setSettings({ timelapse: true }));
  expect(watchFold(closed)?.open).toBe(true);
  useJobWatchStore.getState().setSettings(before);
});

function watchFold(host: HTMLElement): HTMLDetailsElement | undefined {
  return [...host.querySelectorAll('details')].find((fold) =>
    fold.querySelector('summary')?.textContent?.startsWith('Watch the job'),
  );
}
