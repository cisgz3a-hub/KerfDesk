import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cameraBindingCompatibility,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import type { CameraBridgeAdapter } from '../../platform/types';
import { cameraCaptureBindingForFrame, captureSourceFrame } from '../camera/frame-source';
import { useCameraStore } from './camera-store';
import { loadRtspCameraUrl, saveRtspCameraUrl } from './camera-preference-storage';

const BASE = 'rtsp://192.168.1.10/cam/realmonitor';
const BRIDGE: CameraBridgeAdapter = {
  isSupported: () => true,
  probeRtspCamera: async ({ url }) => ({
    kind: 'ok',
    url,
    ffmpegAvailable: true,
    previewUrl: 'http://localhost/preview.mjpg',
  }),
  rtspStreamStatus: async () => ({ kind: 'live' }),
  discoverMachineCamera: async () => ({ kind: 'not-found' }),
  proxiedFrameUrl: () => 'http://localhost/frame.jpg',
  health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  useCameraStore.getState().stopSource();
  localStorage.clear();
});
afterEach(() => {
  useCameraStore.getState().stopSource();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function capture(url: string): Promise<CameraCaptureBinding> {
  await useCameraStore.getState().startRtspSource(BRIDGE, url);
  const state = useCameraStore.getState().sourceState;
  expect(state.kind).toBe('live');
  if (state.kind !== 'live') throw new Error('Expected a live source');
  return cameraCaptureBindingForFrame(state.source, 1280, 720);
}

describe('RTSP resource capture binding', () => {
  it('does not reuse ambiguous legacy calibration for the remembered default feed', async () => {
    saveRtspCameraUrl(`${BASE}?channel=2`);
    const remembered = loadRtspCameraUrl();
    expect(remembered).toBe(BASE);
    const current = await capture(remembered ?? '');
    const { queryFingerprint: _identity, ...legacy } = current;
    expect(cameraBindingCompatibility(legacy, current)).toBe('unbound');
    expect(cameraBindingCompatibility(legacy, legacy)).toBe('unbound');
  });

  it('does not export a public verifier for a low-entropy query password', async () => {
    const binding = await capture(`${BASE}?channel=1&password=0042`);
    const digest = binding.queryFingerprint?.split(':').at(-1);
    expect(digest).toBeDefined();
    const guesses = Array.from({ length: 10000 }, (_, value) =>
      createHash('sha256')
        .update(`?channel=1&password=${String(value).padStart(4, '0')}`)
        .digest('hex'),
    );
    expect(guesses).not.toContain(digest);
  });

  it.each(['channel=2&subtype=0', 'channel=1&subtype=1', ''])(
    'distinguishes resource query %s after source activation',
    async (query) => {
      const saved = await capture(`${BASE}?channel=1&subtype=0`);
      const current = await capture(`${BASE}${query === '' ? '' : `?${query}`}`);
      expect(cameraBindingCompatibility(saved, current)).toBe('source-mismatch');
    },
  );

  it('ignores changed URL userinfo and fragments for the same resource', async () => {
    const first = await capture('rtsp://user:password@192.168.1.10/cam/realmonitor?channel=1#one');
    const second = await capture('rtsp://other:changed@192.168.1.10/cam/realmonitor?channel=1#two');
    expect(first.sourceId).toBe(BASE);
    expect(cameraBindingCompatibility(first, second)).toBe('match');
  });

  it('retains an opaque query identity through project save/reload without raw query or credentials', async () => {
    const url =
      'rtsp://operator:password@192.168.1.10/cam/realmonitor?channel=1&token=private-query#secret-fragment';
    const binding = await capture(url);
    expect(binding).toMatchObject({
      queryFingerprint: expect.stringMatching(/^hmac-sha256:[0-9a-f]{64}$/),
    });
    const project = createProject();
    const encoded = serializeProject({
      ...project,
      device: {
        ...project.device,
        cameraAlignment: {
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          frameWidth: 1280,
          frameHeight: 720,
          basis: 'rectified',
          planeHeightMm: 0,
          alignedAt: 1,
          capture: binding,
        },
        cameraCalibration: {
          intrinsics: { fx: 1000, fy: 1000, cx: 640, cy: 360 },
          distortion: [0, 0, 0, 0],
          imageWidth: 1280,
          imageHeight: 720,
          rmsPx: 0,
          calibratedAt: 1,
          capture: binding,
        },
      },
    });
    for (const secret of ['operator', 'password', 'private-query', 'secret-fragment', 'channel=1'])
      expect(encoded).not.toContain(secret);
    const loaded = deserializeProject(encoded);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.project.device.cameraAlignment?.capture).toEqual(binding);
    expect(loaded.project.device.cameraCalibration?.capture).toEqual(binding);
    const localSecret = localStorage.getItem('laserforge.camera.resourceIdentityKey.v1');
    expect(localSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(encoded).not.toContain(localSecret);
    expect(encoded).not.toContain('resourceIdentityKey');
    const sameAppReload = await capture(url);
    expect(
      cameraBindingCompatibility(loaded.project.device.cameraAlignment?.capture, sameAppReload),
    ).toBe('match');
    const different = await capture(`${BASE}?channel=2&token=private-query`);
    expect(
      cameraBindingCompatibility(loaded.project.device.cameraAlignment?.capture, different),
    ).toBe('source-mismatch');
    saveRtspCameraUrl(url);
    expect(loadRtspCameraUrl()).toBe(BASE);
  });

  it('requires a new matching binding after the app-local key is lost', async () => {
    const saved = await capture(`${BASE}?channel=1`);
    localStorage.clear();
    const current = await capture(`${BASE}?channel=1`);
    expect(cameraBindingCompatibility(saved, current)).toBe('source-mismatch');
  });

  it('keeps raw capture usable when secure identity is unavailable', async () => {
    const saved = await capture(BASE);
    vi.stubGlobal('crypto', undefined);
    const current = await capture(BASE);
    expect(current.queryFingerprint).toBeUndefined();
    expect(cameraBindingCompatibility(saved, current)).toBe('unbound');
    const state = useCameraStore.getState().sourceState;
    if (state.kind !== 'live') throw new Error('Capture should remain live');
    const frame = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    expect(
      await captureSourceFrame(state.source, {
        fetchBlob: async () => new Blob(['frame']),
        decodeToRgba: async () => frame,
      }),
    ).toBe(frame);
  });

  it('does not publish a source stopped while Web Crypto is computing its identity', async () => {
    let finishSignature: (value: ArrayBuffer) => void = () => undefined;
    const signature = new Promise<ArrayBuffer>((resolve) => {
      finishSignature = resolve;
    });
    const sign = vi.spyOn(webcrypto.subtle, 'sign').mockReturnValueOnce(signature);
    const starting = useCameraStore.getState().startRtspSource(BRIDGE, BASE);
    await vi.waitFor(() => expect(sign).toHaveBeenCalled());
    useCameraStore.getState().stopSource();
    finishSignature(new Uint8Array(32).buffer);
    await starting;
    expect(useCameraStore.getState().sourceState.kind).toBe('idle');
  });

  it('carries discovered JPEG query identity into activation and frame capture', async () => {
    const bridge: CameraBridgeAdapter = {
      ...BRIDGE,
      discoverMachineCamera: async () => ({
        kind: 'found',
        cameraUrl: 'http://camera.local/frame.jpg?channel=1',
        proxyFrameUrl: 'http://localhost/frame.jpg',
      }),
    };
    await useCameraStore.getState().detectMachineCamera(bridge);
    const discovered = useCameraStore.getState().machineCamera;
    expect(discovered.kind).toBe('found');
    if (discovered.kind !== 'found') return;
    expect(discovered.queryFingerprint).toMatch(/^hmac-sha256:/);
    useCameraStore.getState().activateMachineCamera();
    const active = useCameraStore.getState().sourceState;
    expect(active.kind).toBe('live');
    if (active.kind !== 'live') return;
    const binding = cameraCaptureBindingForFrame(active.source, 1280, 720);
    expect(binding.queryFingerprint).toBe(discovered.queryFingerprint);
    expect(binding.sourceId).toBe('http://camera.local/frame.jpg');
  });
});
