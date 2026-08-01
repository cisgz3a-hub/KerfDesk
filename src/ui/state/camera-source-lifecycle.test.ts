import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CameraAdapter,
  CameraBridgeAdapter,
  CameraStream,
  CameraStreamStatus,
} from '../../platform/types';
import { useCameraStore } from './camera-store';

type ControlledCamera = {
  readonly adapter: CameraAdapter;
  readonly emit: (status: CameraStreamStatus) => void;
  readonly stop: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly listCameras: ReturnType<typeof vi.fn>;
};

function controlledCamera(initialStatus: CameraStreamStatus = 'live'): ControlledCamera {
  let handler: ((status: CameraStreamStatus) => void) | null = null;
  const stop = vi.fn();
  const dispose = vi.fn();
  const listCameras = vi.fn(async () => [{ deviceId: 'usb-a', label: 'Overhead USB' }]);
  const opened: CameraStream = {
    stream: {} as MediaStream,
    sourceId: 'usb-a',
    resizeMode: 'none',
    stop,
    onStatusChange: (next) => {
      handler = next;
      next(initialStatus);
      return dispose;
    },
  };
  return {
    stop,
    dispose,
    listCameras,
    emit: (status) => handler?.(status),
    adapter: {
      isSupported: () => true,
      listCameras,
      openStream: async () => opened,
      discoverNetworkCamera: async () => null,
    },
  };
}

function rtspBridge(
  probe = vi.fn(),
  rtspStreamStatus: CameraBridgeAdapter['rtspStreamStatus'] = async () => ({ kind: 'live' }),
  hasStreamSession = true,
): CameraBridgeAdapter {
  probe.mockImplementation(async () => ({
    kind: 'ok',
    url: 'rtsp://192.168.10.1:8554/',
    ffmpegAvailable: true,
    previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=x',
    ...(hasStreamSession ? { streamSessionId: `session-${probe.mock.calls.length}` } : {}),
  }));
  return {
    isSupported: () => true,
    probeRtspCamera: probe,
    rtspStreamStatus,
    discoverMachineCamera: async () => ({ kind: 'not-found' }),
    proxiedFrameUrl: () => 'http://127.0.0.1:51731/frame.jpg?url=x',
    health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
  };
}

beforeEach(() => {
  useCameraStore.setState({
    cameras: [],
    selectedDeviceId: null,
    sourceState: { kind: 'idle' },
    sourceEpoch: 0,
    usbAvailability: { kind: 'available' },
    usbSourceRelease: null,
  });
});

describe('USB camera lifecycle', () => {
  it('keeps temporary mute informational, then recovers on unmute', async () => {
    const camera = controlledCamera();
    await useCameraStore.getState().startUsbSource(camera.adapter);

    camera.emit('muted');
    expect(useCameraStore.getState().sourceState.kind).toBe('live');
    expect(useCameraStore.getState().usbAvailability.kind).toBe('muted');

    camera.emit('live');
    expect(useCameraStore.getState().sourceState.kind).toBe('live');
    expect(useCameraStore.getState().usbAvailability.kind).toBe('available');
  });

  it('leaves live state on terminal end, releases the stream, and refreshes devices', async () => {
    const camera = controlledCamera();
    await useCameraStore.getState().startUsbSource(camera.adapter);
    const epochWhileLive = useCameraStore.getState().sourceEpoch;

    camera.emit('ended');

    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'error',
      sourceKind: 'usb',
    });
    expect(useCameraStore.getState().sourceEpoch).toBe(epochWhileLive + 1);
    expect(camera.dispose).toHaveBeenCalledTimes(1);
    expect(camera.stop).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(camera.listCameras).toHaveBeenCalledTimes(2));
  });

  it('does not let a stale ended callback overwrite a replacement source', async () => {
    const first = controlledCamera();
    const second = controlledCamera();
    await useCameraStore.getState().startUsbSource(first.adapter);
    await useCameraStore.getState().startUsbSource(second.adapter);

    first.emit('ended');

    const current = useCameraStore.getState().sourceState;
    expect(current.kind).toBe('live');
    if (current.kind === 'live' && current.source.kind === 'usb') {
      expect(current.source.stream.sourceId).toBe('usb-a');
      expect(current.source.stream.stop).not.toBe(first.stop);
    }
  });

  it('keeps explicit Stop idle even if an old callback arrives later', async () => {
    const camera = controlledCamera();
    await useCameraStore.getState().startUsbSource(camera.adapter);

    useCameraStore.getState().stopSource();
    camera.emit('ended');

    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
    expect(camera.dispose).toHaveBeenCalledTimes(1);
    expect(camera.stop).toHaveBeenCalledTimes(1);
  });

  it('handles a stream that is already ended when lifecycle observation attaches', async () => {
    const camera = controlledCamera('ended');

    await useCameraStore.getState().startUsbSource(camera.adapter);

    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'error',
      sourceKind: 'usb',
    });
    expect(camera.stop).toHaveBeenCalledTimes(1);
  });
});

describe('RTSP camera lifecycle', () => {
  it('keeps a usable legacy preview live as explicitly unmonitored without polling', async () => {
    const probe = vi.fn();
    const status = vi.fn(async () => ({ kind: 'live' as const }));
    const bridge = rtspBridge(probe, status, false);

    await useCameraStore.getState().startRtspSource(bridge, 'rtsp://192.168.10.1:8554/');

    const current = useCameraStore.getState().sourceState;
    expect(current.kind).toBe('live');
    if (current.kind !== 'live' || current.source.kind !== 'machine-rtsp') return;
    expect(current.source.liveness).toMatchObject({
      kind: 'unmonitored',
      advisory: expect.stringContaining('does not report RTSP preview liveness'),
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('keeps a modern preview bound to its monitored session without probing again', async () => {
    const probe = vi.fn();
    const status = vi.fn(async () => ({ kind: 'live' as const }));
    const bridge = rtspBridge(probe, status);

    await useCameraStore.getState().startRtspSource(bridge, 'rtsp://192.168.10.1:8554/');

    const current = useCameraStore.getState().sourceState;
    expect(current.kind).toBe('live');
    if (current.kind !== 'live' || current.source.kind !== 'machine-rtsp') return;
    expect(current.source.liveness).toEqual({
      kind: 'monitored',
      streamSessionId: 'session-1',
    });
    await vi.waitFor(() => expect(status).toHaveBeenCalledWith('session-1'));
    expect(probe).toHaveBeenCalledTimes(1);
    useCameraStore.getState().stopSource();
  });

  it('uses authoritative bridge failure to leave live without probing or reconnecting again', async () => {
    const probe = vi.fn();
    const status = vi.fn(async () => ({
      kind: 'failed' as const,
      reason: 'FFmpeg camera preview ended unexpectedly.',
    }));
    const bridge = rtspBridge(probe, status);

    await useCameraStore.getState().startRtspSource(bridge, 'rtsp://192.168.10.1:8554/');

    await vi.waitFor(() =>
      expect(useCameraStore.getState().sourceState).toMatchObject({
        kind: 'error',
        sourceKind: 'machine-rtsp',
      }),
    );
    expect(status).toHaveBeenCalledWith('session-1');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('ignores a late failed heartbeat from a superseded source epoch', async () => {
    let resolveFirstStatus: ((status: { kind: 'failed'; reason: string }) => void) | undefined;
    const firstStatus = vi.fn(
      () =>
        new Promise<{ kind: 'failed'; reason: string }>((resolve) => {
          resolveFirstStatus = resolve;
        }),
    );
    const firstBridge = rtspBridge(vi.fn(), firstStatus);
    const secondBridge = rtspBridge();
    const url = 'rtsp://192.168.10.1:8554/';
    await useCameraStore.getState().startRtspSource(firstBridge, url);
    await useCameraStore.getState().startRtspSource(secondBridge, url);
    const replacement = useCameraStore.getState().sourceState;

    resolveFirstStatus?.({ kind: 'failed', reason: 'Old FFmpeg ended.' });
    await Promise.resolve();
    await Promise.resolve();

    expect(useCameraStore.getState().sourceState).toBe(replacement);
  });

  it('moves only the exact failed preview to error and reconnects through a fresh probe', async () => {
    const probe = vi.fn();
    const bridge = rtspBridge(probe);
    const url = 'rtsp://192.168.10.1:8554/';
    await useCameraStore.getState().startRtspSource(bridge, url);
    const first = useCameraStore.getState().sourceState;
    expect(first.kind).toBe('live');
    if (first.kind !== 'live' || first.source.kind !== 'machine-rtsp') return;

    useCameraStore.getState().reportSourceFailure(first.source);
    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'error',
      sourceKind: 'machine-rtsp',
    });

    await useCameraStore.getState().startRtspSource(bridge, url);
    const replacement = useCameraStore.getState().sourceState;
    expect(replacement.kind).toBe('live');
    expect(probe).toHaveBeenCalledTimes(2);
    if (replacement.kind === 'live' && replacement.source.kind === 'machine-rtsp') {
      expect(replacement.source.liveness).toEqual({
        kind: 'monitored',
        streamSessionId: 'session-2',
      });
    }

    useCameraStore.getState().reportSourceFailure(first.source);
    expect(useCameraStore.getState().sourceState).toBe(replacement);
  });
});
