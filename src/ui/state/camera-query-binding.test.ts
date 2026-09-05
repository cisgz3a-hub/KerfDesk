import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cameraBindingCompatibility,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import type { CameraBridgeAdapter } from '../../platform/types';
import { cameraCaptureBindingForFrame } from '../camera/frame-source';
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
  useCameraStore.getState().stopSource();
  localStorage.clear();
});
afterEach(() => useCameraStore.getState().stopSource());

async function capture(url: string): Promise<CameraCaptureBinding> {
  await useCameraStore.getState().startRtspSource(BRIDGE, url);
  const state = useCameraStore.getState().sourceState;
  expect(state.kind).toBe('live');
  if (state.kind !== 'live') throw new Error('Expected a live source');
  return cameraCaptureBindingForFrame(state.source, 1280, 720);
}

describe('RTSP resource capture binding', () => {
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
      queryFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
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
    const different = await capture(`${BASE}?channel=2&token=private-query`);
    expect(
      cameraBindingCompatibility(loaded.project.device.cameraAlignment?.capture, different),
    ).toBe('source-mismatch');
    saveRtspCameraUrl(url);
    expect(loadRtspCameraUrl()).toBe(BASE);
  });
});
