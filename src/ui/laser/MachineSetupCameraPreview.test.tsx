import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraProfile } from '../../core/camera';
import type { CameraBridgeAdapter } from '../../platform/types';
import { BrowserCameraPreview } from './MachineSetupCameraPreview';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const camera: CameraProfile = {
  id: 'workspace-camera',
  name: 'Workspace camera',
  deviceId: '',
  enabled: true,
  resolution: { width: 1280, height: 720 },
  transparency: 0.25,
};

async function renderPreview(props?: {
  readonly camera?: CameraProfile;
  readonly cameraBridge?: CameraBridgeAdapter;
  readonly updateCamera?: (patch: Partial<CameraProfile>) => void;
}): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <BrowserCameraPreview
        camera={props?.camera ?? camera}
        cameraBridge={props?.cameraBridge}
        updateCamera={props?.updateCamera ?? vi.fn()}
      />,
    );
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  });
});

describe('BrowserCameraPreview', () => {
  it('unlocks camera permission before listing devices so external cameras can appear', async () => {
    const stop = vi.fn();
    const enumerateDevices = vi
      .fn<MediaDevices['enumerateDevices']>()
      .mockResolvedValueOnce([videoDevice({ deviceId: '', label: '' })])
      .mockResolvedValueOnce([
        videoDevice({ deviceId: 'integrated', label: 'Laptop camera' }),
        videoDevice({ deviceId: 'usb-camera', label: 'USB camera' }),
      ]);
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream);
    installMediaDevices({ enumerateDevices, getUserMedia });
    const { host, unmount } = await renderPreview();
    try {
      await clickAndFlush(button(host, 'List cameras'));

      expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
      expect(stop).toHaveBeenCalled();
      const options = [...host.querySelectorAll('option')].map((option) => option.textContent);
      expect(options).toEqual(['Default camera', 'Laptop camera', 'USB camera']);
      expect(host.textContent).not.toContain('Only one browser camera is visible');
    } finally {
      await unmount();
    }
  });

  it('shows a clear warning when the browser still exposes only one camera', async () => {
    const enumerateDevices = vi
      .fn<MediaDevices['enumerateDevices']>()
      .mockResolvedValue([videoDevice({ deviceId: 'integrated', label: 'Laptop camera' })]);
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream);
    installMediaDevices({ enumerateDevices, getUserMedia });
    const { host, unmount } = await renderPreview();
    try {
      await clickAndFlush(button(host, 'List cameras'));

      expect(host.textContent).toContain('Only one browser camera is visible');
      expect(host.textContent).toContain('RTSP mode');
    } finally {
      await unmount();
    }
  });

  it('lets users switch from browser camera mode to the built-in RTSP camera path', async () => {
    const updateCamera = vi.fn();
    installMediaDevices({
      enumerateDevices: vi
        .fn<MediaDevices['enumerateDevices']>()
        .mockResolvedValue([videoDevice({ deviceId: 'integrated', label: 'Laptop camera' })]),
      getUserMedia: vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream),
    });
    const { host, unmount } = await renderPreview({ updateCamera });
    try {
      await clickAndFlush(button(host, 'Use built-in RTSP camera'));

      expect(updateCamera).toHaveBeenCalledWith({
        source: { kind: 'rtsp', url: 'rtsp://192.168.10.1:8554/' },
      });
    } finally {
      await unmount();
    }
  });

  it('refreshes the camera list after preview starts', async () => {
    const updateCamera = vi.fn();
    const enumerateDevices = vi
      .fn<MediaDevices['enumerateDevices']>()
      .mockResolvedValue([videoDevice({ deviceId: 'usb-camera', label: 'USB camera' })]);
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream);
    installMediaDevices({ enumerateDevices, getUserMedia });
    const { host, unmount } = await renderPreview({ updateCamera });
    try {
      await clickAndFlush(button(host, 'Start preview'));

      expect(enumerateDevices).toHaveBeenCalled();
      expect(host.textContent).toContain('USB camera');
    } finally {
      await unmount();
    }
  });

  it('renders RTSP bridge controls instead of browser camera picker for RTSP sources', async () => {
    const cameraBridge: CameraBridgeAdapter = {
      isSupported: () => true,
      probeRtspCamera: vi.fn<CameraBridgeAdapter['probeRtspCamera']>(async () => ({
        kind: 'ok',
        url: 'rtsp://192.168.10.1:8554/',
        codec: 'H264',
        ffmpegAvailable: false,
      })),
      discoverMachineCamera: async () => ({ kind: 'not-found' }),
      proxiedFrameUrl: (cameraUrl) =>
        `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
      health: async () => ({ kind: 'ok', ffmpegAvailable: false, frameProxy: true }),
    };
    const { host, unmount } = await renderPreview({
      camera: {
        ...camera,
        source: { kind: 'rtsp', url: 'rtsp://192.168.10.1:8554/' },
      },
      cameraBridge,
    });
    try {
      expect(host.textContent).toContain('RTSP Bridge Preview');
      expect(host.textContent).toContain('rtsp://192.168.10.1:8554/');
      expect(button(host, 'Probe RTSP camera')).toBeInstanceOf(HTMLButtonElement);
      expect(host.textContent).not.toContain('List cameras');

      await clickAndFlush(button(host, 'Probe RTSP camera'));

      expect(cameraBridge.probeRtspCamera).toHaveBeenCalledWith({
        url: 'rtsp://192.168.10.1:8554/',
      });
      expect(host.textContent).toContain('RTSP reachable');
      expect(host.textContent).toContain('FFmpeg preview bridge is not available');
    } finally {
      await unmount();
    }
  });
});

function installMediaDevices(mediaDevices: Partial<MediaDevices>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });
}

function videoDevice(input: {
  readonly deviceId: string;
  readonly label: string;
}): MediaDeviceInfo {
  return {
    deviceId: input.deviceId,
    groupId: '',
    kind: 'videoinput',
    label: input.label,
    toJSON: () => ({}),
  };
}

async function clickAndFlush(target: HTMLButtonElement): Promise<void> {
  await act(async () => {
    target.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}
