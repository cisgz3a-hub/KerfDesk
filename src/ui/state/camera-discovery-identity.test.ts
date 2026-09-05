import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraBridgeAdapter } from '../../platform/types';
import { useCameraStore } from './camera-store';

const FIRST_URL = 'http://camera.local/frame.jpg?channel=1';
const SECOND_URL = 'http://camera.local/frame.jpg?channel=2';

function bridge(cameraUrl: string): CameraBridgeAdapter {
  return {
    isSupported: () => true,
    probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'unused' }),
    rtspStreamStatus: async () => ({ kind: 'live' }),
    discoverMachineCamera: async () => ({
      kind: 'found',
      cameraUrl,
      proxyFrameUrl: `http://localhost/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
    }),
    proxiedFrameUrl: () => 'http://localhost/frame.jpg',
    health: async () => ({ kind: 'ok', ffmpegAvailable: true, frameProxy: true }),
  };
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  useCameraStore.setState({ machineCamera: { kind: 'idle' } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('network discovery identity ownership', () => {
  it('retains the newer discovered camera when an older HMAC completes last', async () => {
    let finishSignature: (value: ArrayBuffer) => void = () => undefined;
    const signature = new Promise<ArrayBuffer>((resolve) => {
      finishSignature = resolve;
    });
    const sign = vi.spyOn(webcrypto.subtle, 'sign').mockReturnValueOnce(signature);
    const first = useCameraStore.getState().detectMachineCamera(bridge(FIRST_URL));
    await vi.waitFor(() => expect(sign).toHaveBeenCalled());
    await useCameraStore.getState().detectMachineCamera(bridge(SECOND_URL));
    const second = useCameraStore.getState().machineCamera;
    expect(second).toMatchObject({ kind: 'found', cameraUrl: SECOND_URL });
    finishSignature(new Uint8Array(32).buffer);
    await first;
    expect(useCameraStore.getState().machineCamera).toBe(second);
  });

  it('ignores pending discovery after a newer request has no available bridge', async () => {
    type Discovery = Awaited<ReturnType<CameraBridgeAdapter['discoverMachineCamera']>>;
    let finishDiscovery: (value: Discovery) => void = () => undefined;
    const discovery = new Promise<Discovery>((resolve) => {
      finishDiscovery = resolve;
    });
    const first = useCameraStore.getState().detectMachineCamera({
      ...bridge(FIRST_URL),
      discoverMachineCamera: () => discovery,
    });
    await useCameraStore.getState().detectMachineCamera(undefined);
    const unavailable = useCameraStore.getState().machineCamera;
    expect(unavailable.kind).toBe('unavailable');
    finishDiscovery({ kind: 'found', cameraUrl: FIRST_URL, proxyFrameUrl: 'http://localhost/old' });
    await first;
    expect(useCameraStore.getState().machineCamera).toBe(unavailable);
  });
});
