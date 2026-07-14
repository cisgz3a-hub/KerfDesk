// G38: a SETTLED tool-change hold must enable the JogPad (jog + Zero Z) so the
// operator can touch off the new bit, mirroring the store's setup-gate carve-out.
// Split from LaserWindow.test.tsx to keep each test file under the size cap.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, onAck, step, type StreamerState } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { LaserWindow } from './LaserWindow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

// A tool-change hold whose pre-M0 motion has fully drained (inFlight empty):
// the machine has physically reached the tool-change position.
function drainedToolChangeStreamer(): StreamerState {
  let state = step(createStreamer('G0 X0\nM0\nG0 Z5', { toolChangePause: true })).state;
  while (state.inFlight.length > 0) {
    state = step(onAck(state, 'ok').state).state;
  }
  return state;
}

const IDLE_STATUS = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

function jogArrows(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter((b) =>
    ['↑', '↓', '←', '→'].includes(b.textContent ?? ''),
  );
}

async function renderInHold(toolChangeIdleSeen: boolean): Promise<{
  readonly arrows: HTMLButtonElement[];
  readonly cleanup: () => Promise<void>;
}> {
  useLaserStore.setState({
    connection: { kind: 'connected' },
    streamer: drainedToolChangeStreamer(),
    toolChangeIdleSeen,
    statusReport: IDLE_STATUS,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <LaserWindow />
      </PlatformProvider>,
    );
  });
  return {
    arrows: jogArrows(host),
    cleanup: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    streamer: null,
    statusReport: null,
    toolChangeIdleSeen: false,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('LaserWindow jog gating during a tool-change hold (G38)', () => {
  it('enables the JogPad at a settled tool-change hold so the new bit can be zeroed', async () => {
    // Fresh Idle observed after the pre-M0 retract drained: the hold is ready.
    const { arrows, cleanup } = await renderInHold(true);
    try {
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.disabled).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('keeps the JogPad disabled at a tool-change hold that has not yet settled', async () => {
    // No fresh Idle yet — the retract/park may still be moving.
    const { arrows, cleanup } = await renderInHold(false);
    try {
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.disabled).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
