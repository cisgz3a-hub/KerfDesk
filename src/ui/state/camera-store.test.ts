import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraAdapter } from '../../platform/types';
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

beforeEach(() => {
  useCameraStore.setState({
    isSupported: false,
    cameras: [],
    selectedDeviceId: null,
    stream: { kind: 'idle' },
    alignment: { kind: 'idle' },
    streamEpoch: 0,
    networkCamera: { kind: 'idle' },
  });
});

describe('camera-store', () => {
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
    await useCameraStore.getState().refreshCameras(
      mockCamera({ listCameras: async () => [{ deviceId: 'a', label: 'A' }] }),
    );
    expect(useCameraStore.getState().selectedDeviceId).toBe('a');
  });

  it('goes live and stop() releases the stream', async () => {
    const stop = vi.fn();
    // Only the shape webCamera produces is needed; cast the empty MediaStream.
    const opened = { stream: {} as MediaStream, stop };
    await useCameraStore.getState().startStream(mockCamera({ openStream: async () => opened }));
    expect(useCameraStore.getState().stream).toEqual({ kind: 'live', stream: opened });
    useCameraStore.getState().stopStream();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useCameraStore.getState().stream.kind).toBe('idle');
  });

  it('reports denied when openStream resolves null', async () => {
    await useCameraStore.getState().startStream(mockCamera({ openStream: async () => null }));
    expect(useCameraStore.getState().stream.kind).toBe('denied');
  });

  it('reports an error when openStream throws', async () => {
    await useCameraStore
      .getState()
      .startStream(mockCamera({ openStream: async () => Promise.reject(new Error('busy')) }));
    const { stream } = useCameraStore.getState();
    expect(stream.kind).toBe('error');
    if (stream.kind === 'error') expect(stream.message).toBe('busy');
  });

  it('reports an error when no camera adapter is present', async () => {
    await useCameraStore.getState().startStream(undefined);
    expect(useCameraStore.getState().stream.kind).toBe('error');
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

    const startA = useCameraStore.getState().startStream(cameraA); // hangs on pendingA
    await useCameraStore.getState().startStream(cameraB); // supersedes A -> live B
    resolveA(streamA); // A resolves late, after being superseded
    await startA;

    expect(stopA).toHaveBeenCalledTimes(1); // orphaned A released, no leak
    expect(stopB).not.toHaveBeenCalled();
    expect(useCameraStore.getState().stream).toEqual({ kind: 'live', stream: streamB });
  });

  it('detects a network camera (Falcon) and stores its frame URL', async () => {
    const camera = mockCamera({
      discoverNetworkCamera: async () => ({
        frameUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
      }),
    });
    await useCameraStore.getState().detectNetworkCamera(camera);
    expect(useCameraStore.getState().networkCamera).toEqual({
      kind: 'found',
      frameUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
    });
  });

  it('reports not-found when no network camera responds', async () => {
    await useCameraStore
      .getState()
      .detectNetworkCamera(mockCamera({ discoverNetworkCamera: async () => null }));
    expect(useCameraStore.getState().networkCamera.kind).toBe('not-found');
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
