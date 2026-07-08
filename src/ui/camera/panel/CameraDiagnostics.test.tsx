import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CameraBridgeAdapter, PlatformAdapter } from '../../../platform/types';
import { PlatformProvider } from '../../app/platform-context';
import { useCameraStore } from '../../state/camera-store';
import { CameraDiagnostics } from './CameraDiagnostics';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mockBridge(overrides?: Partial<CameraBridgeAdapter>): CameraBridgeAdapter {
  return {
    isSupported: () => true,
    probeRtspCamera: async () => ({ kind: 'unavailable', reason: 'not under test' }),
    discoverMachineCamera: async () => ({ kind: 'not-found' }),
    proxiedFrameUrl: (cameraUrl) => `http://127.0.0.1:51731/frame.jpg?url=${cameraUrl}`,
    health: async () => ({ kind: 'ok', ffmpegAvailable: false, frameProxy: true }),
    ...overrides,
  };
}

function mockPlatform(bridge: CameraBridgeAdapter | undefined): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
    ...(bridge !== undefined ? { cameraBridge: bridge } : {}),
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useCameraStore.setState({ sourceState: { kind: 'idle' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(bridge: CameraBridgeAdapter | undefined): Promise<void> {
  await act(async () => {
    root.render(
      <PlatformProvider adapter={mockPlatform(bridge)}>
        <CameraDiagnostics />
      </PlatformProvider>,
    );
  });
}

describe('CameraDiagnostics', () => {
  it('reports the bridge capabilities once health resolves', async () => {
    await render(mockBridge());
    expect(container.textContent).toContain('Bridge: running');
    expect(container.textContent).toContain('frame proxy yes');
    expect(container.textContent).toContain('ffmpeg no');
  });

  it('reports an unreachable bridge with its reason', async () => {
    await render(
      mockBridge({ health: async () => ({ kind: 'unavailable', reason: 'bridge down' }) }),
    );
    expect(container.textContent).toContain('Bridge: bridge down');
  });

  it('disables the capture test without a live source and shows the source state', async () => {
    await render(mockBridge());
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Test capture'),
    );
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(true);
    expect(container.textContent).toContain('Source: idle');
  });
});
