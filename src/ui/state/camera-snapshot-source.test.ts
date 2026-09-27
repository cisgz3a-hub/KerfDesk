import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraBridgeAdapter } from '../../platform/types';
import type * as frameSource from '../camera/frame-source';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../camera/frame-source';
import {
  SNAPSHOT_CAMERA_NO_PICTURE,
  SNAPSHOT_CAMERA_POLL_INTERVAL_MS,
} from './camera-snapshot-source';
import { useCameraStore } from './camera-store';

vi.mock('../camera/frame-source', async (importOriginal) => ({
  ...(await importOriginal<typeof frameSource>()),
  captureSourceFrame: vi.fn(),
}));

const PHONE_URL = 'http://192.168.1.50:8080/shot.jpg';
const PICTURE = { width: 2, height: 2, data: new Uint8ClampedArray(16) };

const bridge: CameraBridgeAdapter = {
  isSupported: () => true,
  probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'not under test' }),
  rtspStreamStatus: async () => ({ kind: 'live' }),
  discoverMachineCamera: async () => ({ kind: 'not-found' }),
  proxiedFrameUrl: (cameraUrl) =>
    `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
  health: async () => ({ kind: 'ok', ffmpegAvailable: false, frameProxy: true }),
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  useCameraStore.setState({ sourceState: { kind: 'idle' }, sourceEpoch: 0 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(captureSourceFrame).mockReset();
});

describe('startSnapshotSource', () => {
  it('keeps secrets only in the live request and distinguishes query-specific calibration identity', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValue(PICTURE);
    const firstUrl = 'http://operator:first@secret-tail@192.168.1.50/frame?token=secret&camera=1';
    await useCameraStore.getState().startSnapshotSource(bridge, firstUrl);
    const first = useCameraStore.getState().sourceState;
    if (first.kind !== 'live') throw new Error('First source not live');
    const firstBinding = cameraCaptureBindingForFrame(first.source, 2, 2);
    expect(firstBinding.sourceId).toBe('http://192.168.1.50/frame');
    expect(JSON.stringify(firstBinding)).not.toMatch(/secret|operator|token|camera=1/);
    await useCameraStore
      .getState()
      .startSnapshotSource(bridge, firstUrl.replace('camera=1', 'camera=2'));
    const second = useCameraStore.getState().sourceState;
    if (second.kind !== 'live') throw new Error('Second source not live');
    const secondBinding = cameraCaptureBindingForFrame(second.source, 2, 2);
    expect(secondBinding.sourceId).toBe(firstBinding.sourceId);
    expect(secondBinding.queryFingerprint).not.toBe(firstBinding.queryFingerprint);
    expect(firstBinding.queryFingerprint).toMatch(/^hmac-sha256:/);
  });

  it('does not let an older initial picture replace a newer camera', async () => {
    let send: (picture: typeof PICTURE) => void = () => undefined;
    vi.mocked(captureSourceFrame).mockReturnValueOnce(
      new Promise((resolve) => {
        send = resolve;
      }),
    );
    const older = useCameraStore.getState().startSnapshotSource(bridge, PHONE_URL);
    vi.mocked(captureSourceFrame).mockResolvedValue(PICTURE);
    const newerUrl = PHONE_URL.replace('.50:', '.51:');
    await useCameraStore.getState().startSnapshotSource(bridge, newerUrl);
    send(PICTURE);
    await older;
    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'live',
      source: { cameraUrl: newerUrl },
    });
  });

  it('goes live on the phone once it sends a picture', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValue(PICTURE);
    await useCameraStore.getState().startSnapshotSource(bridge, PHONE_URL);
    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'live',
      source: {
        kind: 'machine-jpeg',
        cameraUrl: PHONE_URL,
        frameUrl: bridge.proxiedFrameUrl(PHONE_URL),
        pollIntervalMs: SNAPSHOT_CAMERA_POLL_INTERVAL_MS,
        // The capture binding tells this camera apart from the laser's own.
        queryFingerprint: expect.stringMatching(/^hmac-sha256:/),
      },
    });
  });

  it('says so when the phone sends no picture', async () => {
    vi.mocked(captureSourceFrame).mockResolvedValue(null);
    await useCameraStore.getState().startSnapshotSource(bridge, PHONE_URL);
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'error',
      sourceKind: 'machine-jpeg',
      message: SNAPSHOT_CAMERA_NO_PICTURE,
    });
  });

  it('needs the camera bridge', async () => {
    await useCameraStore.getState().startSnapshotSource(undefined, PHONE_URL);
    expect(useCameraStore.getState().sourceState).toMatchObject({
      kind: 'error',
      sourceKind: 'machine-jpeg',
    });
    expect(captureSourceFrame).not.toHaveBeenCalled();
  });

  it('stays stopped when Stop is pressed while the first picture loads', async () => {
    let send: (picture: typeof PICTURE) => void = () => undefined;
    vi.mocked(captureSourceFrame).mockReturnValue(
      new Promise((resolve) => {
        send = resolve;
      }),
    );
    const starting = useCameraStore.getState().startSnapshotSource(bridge, PHONE_URL);
    expect(useCameraStore.getState().sourceState).toEqual({
      kind: 'starting',
      sourceKind: 'machine-jpeg',
    });
    useCameraStore.getState().stopSource();
    send(PICTURE);
    await starting;
    expect(useCameraStore.getState().sourceState).toEqual({ kind: 'idle' });
  });
});
