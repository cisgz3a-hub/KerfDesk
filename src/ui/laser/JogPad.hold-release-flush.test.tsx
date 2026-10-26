// Regression test for ADR-640, driven through the real JogPad and laser store:
// a Falcon on the Falcon-compatible (GRBL) profile showed "Stop jog: Cancel is
// waiting for the previous motion command acknowledgement" when an arrow was
// let go just after its hold jog went out, and the pad stayed locked. Creality's
// firmware is grblHAL-based, and grblHAL discards every line it has not parsed
// yet when the jog-cancel byte arrives, without answering it
// (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899),
// while greeting as "Grbl 1.1f" (audit HF-8). The simulator's
// jogCancelFlushesInput models that flush.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { FALCON_COMPATIBLE_PROFILE } from '../../core/devices/falcon-profiles';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(2_000);
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    lastWriteError: null,
    safetyNotice: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  });
  useToastStore.setState({ toasts: [] });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('JogPad hold released just after its jog went out', () => {
  it('stops the jog on a Falcon-compatible profile and leaves the pad usable', async () => {
    useStore.getState().updateDeviceProfile(FALCON_COMPATIBLE_PROFILE);
    const sim = createGrblSimulator({
      motionMs: 4_000,
      responseDelayMs: 3,
      jogCancelFlushesInput: true,
    });
    await useLaserStore
      .getState()
      .connect(sim.adapter, connectOptionsForDevice(FALCON_COMPATIBLE_PROFILE));
    await pump(1_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().capabilities.jogCancel).toBe(true);
    useJogControlPreferences.setState({ stepMm: 10, requestedFeedMmPerMin: 3000 });

    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(<JogPad disabled={false} />);
    });
    try {
      const right = [...host.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === 'Jog +X 10 mm',
      );
      if (right === undefined) throw new Error('right jog button missing');
      const before = sim.outbound().length;

      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      });
      // The hold delay ends and the boundary-length $J= goes out ...
      await pump(250);
      expect(
        sim
          .outbound()
          .slice(before)
          .some((data) => data.startsWith('$J=')),
      ).toBe(true);
      // ... and the arrow is let go before the controller has read it.
      await act(async () => {
        right.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
        right.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      });
      // Before ADR-640 the reply wait ran its full 8 s here and then failed.
      await pump(3_000);

      const written = sim.outbound().slice(before);
      const jogIndex = written.findIndex((data) => data.startsWith('$J='));
      expect(written.indexOf(RT_JOG_CANCEL)).toBeGreaterThan(jogIndex);
      expect(sim.state().machine).toBe('Idle');
      const state = useLaserStore.getState();
      expect(state.pendingUntrackedAcks).toBe(0);
      expect(state.motionOperation).toBeNull();
      expect(jogFrameCommandBlockMessage(state)).toBeNull();
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([]);
    } finally {
      await act(async () => (root as Root | null)?.unmount());
      host.remove();
    }
  }, 30_000);
});
