import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAdapter, CameraBridgeAdapter } from '../../platform/types';
import { useCameraStore } from './camera-store';

function mockCamera(overrides?: Partial<CameraAdapter>): CameraAdapter {
  return {
    isSupported: () => true,
    listCameras: async () => [],
    openStream: async () => null,
    discoverNetworkCamera: async () => null,
    ...overrides,
  };
}

function mockBridge(overrides?: Partial<CameraBridgeAdapter>): CameraBridgeAdapter {
  return {
    isSupported: () => true,
    probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'not under test' }),
    discoverMachineCamera: async () => ({ kind: 'not-found' }),
    proxiedFrameUrl: (cameraUrl) =>
      `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
    health: async () => ({ kind: 'ok', ffmpegAvailable: false, frameProxy: true }),
    ...overrides,
  };
}

beforeEach(() => {
  // selectCamera persists the preferred device; isolate tests from each other.
  localStorage.clear();
  useCameraStore.setState({
    panelOpen: false,
    isSupported: false,
    cameras: [],
    selectedDeviceId: null,
    sourceState: { kind: 'idle' },
    alignment: { kind: 'idle' },
    sourceEpoch: 0,
    machineCamera: { kind: 'idle' },
    overlayVisible: true,
    overlayOpacityPercent: 50,
    overlayStill: null,
  });
});

describe('camera-store', () => {
  it('overlay prefs default sensibly and the opacity clamps to 0..100', () => {
    expect(useCameraStore.getState().overlayVisible).toBe(true);
    expect(useCameraStore.getState().overlayOpacityPercent).toBe(50);
    useCameraStore.getState().setOverlayOpacityPercent(140);
    expect(useCameraStore.getState().overlayOpacityPercent).toBe(100);
    useCameraStore.getState().setOverlayOpacityPercent(-5);
    expect(useCameraStore.getState().overlayOpacityPercent).toBe(0);
    useCameraStore.getState().setOverlayVisible(false);
    expect(useCameraStore.getState().overlayVisible).toBe(false);
  });

  it('togglePanel flips the panel and closePanel always closes it', () => {
    useCameraStore.getState().togglePanel();
    expect(useCameraStore.getState().panelOpen).toBe(true);
    useCameraStore.getState().togglePanel();
    expect(useCameraStore.getState().panelOpen).toBe(false);
    useCameraStore.getState().togglePanel();
    useCameraStore.getState().closePanel();
    expect(useCameraStore.getState().panelOpen).toBe(false);
    useCameraStore.getState().closePanel();
    expect(useCameraStore.getState().panelOpen).toBe(false);
  });

  it('detects support from the adapter (and false when absent)', () => {
    useCameraStore.getState().detectSupport(mockCamera({ isSupported: () => true }));
    expect(useCameraStore.getState().isSupported).toBe(true);
    useCameraStore.getState().detectSupport(undefined);
    expect(useCameraStore.getState().isSupported).toBe(false);
  });

  it('refreshes cameras and selects the first by default', async () => {
    const camera = mockCamera({
      listCameras: async () => [
        { deviceId: 'a', label: 'A' },
        { deviceId: 'b', label: 'B' },
      ],
    });
    await useCameraStore.getState().refreshCameras(camera);
    expect(useCameraStore.getState().cameras).toHaveLength(2);
    expect(useCameraStore.getState().selectedDeviceId).toBe('a');
  });

  it('keeps a still-valid selection on refresh', async () => {
    useCameraStore.getState().selectCamera('b');
    await useCameraStore.getState().refreshCameras(
      mockCamera({
        listCameras: async () => [
          { deviceId: 'a', label: 'A' },
          { deviceId: 'b', label: 'B' },
        ],
      }),
    );
    expect(useCameraStore.getState().selectedDeviceId).toBe('b');
  });

  it('drops a stale selection and defaults to the first camera on refresh', async () => {
    useCameraStore.getState().selectCamera('unplugged');
    await useCameraStore
      .getState()
      .refreshCameras(mockCamera({ listCameras: async () => [{ deviceId: 'a', label: 'A' }] }));
    expect(useCameraStore.getState().selectedDeviceId).toBe('a');
  });

  it('restores the remembered camera when it reappears in the list', async () => {
    // A previous session picked the overhead camera 'b' (selectCamera saves it).
    useCameraStore.getState().selectCamera('b');
    useCameraStore.setState({ selectedDeviceId: null }); // fresh session, no live selection
    await useCameraStore.getState().refreshCameras(
      mockCamera({
        listCameras: async () => [
          { deviceId: 'a', label: 'Laptop lid' },
          { deviceId: 'b', label: 'Overhead USB' },
        ],
      }),
    );
    expect(useCameraStore.getState().selectedDeviceId).toBe('b');
  });

  it('goes live as a USB source and stopSource() releases the stream', async () => {
    const stop = vi.fn();
    // Only the shape webCamera produces is needed; cast the empty MediaStream.
    const opened = { stream: {} as MediaStream, stop };
    await useCameraStore.getState().startUsbSource(mockCamera({ openStream: async () => opened }));
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'live',
      source: { kind: 'usb', stream: opened },
    });
    useCameraStore.getState().stopSource();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
  });

  it('reports denied when openStream resolves null', async () => {
    await useCameraStore.getState().startUsbSource(mockCamera({ openStream: async () => null }));
    expect(useCameraStore.getState().sourceState.kind).toBe('denied');
  });

  it('reports an error when openStream throws', async () => {
    await useCameraStore
      .getState()
      .startUsbSource(mockCamera({ openStream: async () => Promise.reject(new Error('busy')) }));
    const { sourceState } = useCameraStore.getState();
    expect(sourceState.kind).toBe('error');
    if (sourceState.kind === 'error') expect(sourceState.message).toBe('busy');
  });

  it('reports an error when no camera adapter is present', async () => {
    await useCameraStore.getState().startUsbSource(undefined);
    expect(useCameraStore.getState().sourceState.kind).toBe('error');
  });

  it('releases an orphaned stream when superseded mid-open (no camera leak)', async () => {
    const stopA = vi.fn();
    const streamA = { stream: {} as MediaStream, stop: stopA };
    let resolveA!: (s: typeof streamA) => void;
    const pendingA = new Promise<typeof streamA>((resolve) => {
      resolveA = resolve;
    });
    const cameraA = mockCamera({ openStream: () => pendingA });

    const stopB = vi.fn();
    const streamB = { stream: {} as MediaStream, stop: stopB };
    const cameraB = mockCamera({ openStream: async () => streamB });

    const startA = useCameraStore.getState().startUsbSource(cameraA); // hangs on pendingA
    await useCameraStore.getState().startUsbSource(cameraB); // supersedes A -> live B
    resolveA(streamA); // A resolves late, after being superseded
    await startA;

    expect(stopA).toHaveBeenCalledTimes(1); // orphaned A released, no leak
    expect(stopB).not.toHaveBeenCalled();
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'live',
      source: { kind: 'usb', stream: streamB },
    });
  });

  it('discovers the machine camera through the bridge', async () => {
    const bridge = mockBridge({
      discoverMachineCamera: async () => ({
        kind: 'found',
        cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
        proxyFrameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
      }),
    });
    await useCameraStore.getState().detectMachineCamera(bridge);
    expect(useCameraStore.getState().machineCamera).toEqual({
      kind: 'found',
      cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
      proxyFrameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
    });
  });

  it('reports not-found and bridge-unavailable distinctly', async () => {
    await useCameraStore.getState().detectMachineCamera(mockBridge());
    expect(useCameraStore.getState().machineCamera.kind).toBe('not-found');

    await useCameraStore.getState().detectMachineCamera(
      mockBridge({
        discoverMachineCamera: async () => ({ kind: 'unavailable', reason: 'bridge down' }),
      }),
    );
    expect(useCameraStore.getState().machineCamera).toEqual({
      kind: 'unavailable',
      reason: 'bridge down',
    });

    await useCameraStore.getState().detectMachineCamera(undefined);
    const noBridge = useCameraStore.getState().machineCamera;
    expect(noBridge.kind).toBe('unavailable');
    if (noBridge.kind === 'unavailable') {
      expect(noBridge.reason).toContain('pnpm camera:bridge');
    }
  });

  it('activates the discovered machine camera as the live source', async () => {
    // Activating replaces a running USB stream (and releases it).
    const stop = vi.fn();
    const opened = { stream: {} as MediaStream, stop };
    await useCameraStore.getState().startUsbSource(mockCamera({ openStream: async () => opened }));
    useCameraStore.setState({
      machineCamera: {
        kind: 'found',
        cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
        proxyFrameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
      },
    });
    useCameraStore.getState().activateMachineCamera();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'live',
      source: {
        kind: 'machine-jpeg',
        frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=x',
        cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
      },
    });
  });

  it('activateMachineCamera is a no-op until discovery has found a camera', () => {
    useCameraStore.getState().activateMachineCamera();
    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
  });

  it('connects an RTSP camera through the bridge probe', async () => {
    const bridge = mockBridge({
      probeRtspCamera: async () => ({
        kind: 'ok',
        url: 'rtsp://192.168.10.1:8554/',
        codec: 'H264',
        ffmpegAvailable: true,
        previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
      }),
    });
    await useCameraStore.getState().startRtspSource(bridge, 'rtsp://192.168.10.1:8554/');
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'live',
      source: {
        kind: 'machine-rtsp',
        previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
        frameUrl: `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(
          'rtsp://192.168.10.1:8554/',
        )}`,
      },
    });
  });

  it('surfaces RTSP failures as actionable errors', async () => {
    await useCameraStore.getState().startRtspSource(
      mockBridge({
        probeRtspCamera: async () => ({
          kind: 'ok',
          url: 'rtsp://192.168.10.1:8554/',
          ffmpegAvailable: false,
        }),
      }),
      'rtsp://192.168.10.1:8554/',
    );
    const noFfmpeg = useCameraStore.getState().sourceState;
    expect(noFfmpeg.kind).toBe('error');
    if (noFfmpeg.kind === 'error') expect(noFfmpeg.message).toContain('FFmpeg');

    await useCameraStore.getState().startRtspSource(
      mockBridge({
        probeRtspCamera: async () => ({ kind: 'invalid', reason: 'Only private RTSP hosts.' }),
      }),
      'rtsp://8.8.8.8/live',
    );
    const invalid = useCameraStore.getState().sourceState;
    expect(invalid.kind).toBe('error');
    if (invalid.kind === 'error') expect(invalid.message).toBe('Only private RTSP hosts.');

    await useCameraStore.getState().startRtspSource(undefined, 'rtsp://192.168.10.1:8554/');
    const noBridge = useCameraStore.getState().sourceState;
    expect(noBridge.kind).toBe('error');
    if (noBridge.kind === 'error') expect(noBridge.message).toContain('pnpm camera:bridge');
  });

  it('drives the alignment flow through to aligned', () => {
    const targets = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];
    const pixels = [
      { x: 40, y: 380 },
      { x: 600, y: 360 },
      { x: 610, y: 30 },
      { x: 30, y: 50 },
    ];
    const store = useCameraStore.getState();
    store.beginAlignment(targets);
    expect(useCameraStore.getState().alignment.kind).toBe('collecting');
    for (const pixel of pixels) store.addAlignmentPoint(pixel);
    expect(useCameraStore.getState().alignment.kind).toBe('aligned');
  });
});
