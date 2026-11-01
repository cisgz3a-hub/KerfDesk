// Keyboard XY jog wiring (LightBurn gap LBG-M07, ADR-493). The jog pad installs
// the keys while it is mounted, so the oracle is what the pad sends through the
// store's jog action: the SAME vector its matching on-screen arrow sends (origin
// signs, step, clamped feed), nothing while the pad is disabled or unmounted,
// and a refusal reported the way an arrow click reports it. A NumLock-off
// keypad never moves the machine: its 9 / 3 send PageUp / PageDown, which once
// jogged a CNC bit down from the key the pad names for +X -Y (controller audit
// v2, C8-P2-1; ADR-493 Amendment 1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { JogPad } from './JogPad';
import { DEFAULT_JOG_STEP_MM, useJogControlPreferences } from './jog-control-preferences';
import { DEFAULT_JOG_FEED_MM_PER_MIN } from './jog-control-policy';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalJog = useLaserStore.getState().jog;

const UP_CHORD: KeyboardEventInit = {
  key: '}',
  code: 'BracketRight',
  ctrlKey: true,
  shiftKey: true,
};
const DOWN_CHORD: KeyboardEventInit = {
  key: '{',
  code: 'BracketLeft',
  ctrlKey: true,
  shiftKey: true,
};
const LEFT_CHORD: KeyboardEventInit = {
  key: '[',
  code: 'BracketLeft',
  ctrlKey: true,
  altKey: true,
};
const RIGHT_CHORD: KeyboardEventInit = {
  key: ']',
  code: 'BracketRight',
  metaKey: true,
  altKey: true,
};

function numpad(digit: string): KeyboardEventInit {
  return { key: digit, code: `Numpad${digit}` };
}

// NumLock off: the keypad's code and location, and the navigation key it sends.
function numLockOff(digit: string, key: string): KeyboardEventInit {
  return { key, code: `Numpad${digit}`, location: KeyboardEvent.DOM_KEY_LOCATION_NUMPAD };
}

async function renderJogPad(disabled = false): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JogPad disabled={disabled} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

async function press(init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
  return event;
}

function arrow(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label,
  );
  if (button === undefined) throw new Error(`jog arrow ${label} missing`);
  return button;
}

afterEach(() => {
  useLaserStore.setState({ jog: originalJog });
  useStore.setState({ project: createProject() });
  useJogControlPreferences.setState({
    stepMm: DEFAULT_JOG_STEP_MM,
    requestedFeedMmPerMin: DEFAULT_JOG_FEED_MM_PER_MIN,
  });
  useToastStore.setState({ toasts: [] });
});

describe('JogPad keyboard XY jog (ADR-493)', () => {
  it('sends exactly what the matching arrow sends on a rear-right machine', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'rear-right', maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();

    const pairs: ReadonlyArray<readonly [KeyboardEventInit, string]> = [
      [UP_CHORD, 'Jog -Y 10 mm'],
      [DOWN_CHORD, 'Jog +Y 10 mm'],
      [LEFT_CHORD, 'Jog +X 10 mm'],
      [RIGHT_CHORD, 'Jog -X 10 mm'],
      [numpad('8'), 'Jog -Y 10 mm'],
      [numpad('7'), 'Jog +X -Y 10 mm'],
      [numpad('3'), 'Jog -X +Y 10 mm'],
    ];
    for (const [init, label] of pairs) {
      jog.mockClear();
      const event = await press(init);
      await act(async () => arrow(host, label).click());
      expect(jog).toHaveBeenCalledTimes(2);
      expect(jog.mock.calls[0], label).toEqual(jog.mock.calls[1]);
      expect(event.defaultPrevented).toBe(true);
    }
    // Physical up on a rear-origin machine is machine -Y (the pad's own label).
    jog.mockClear();
    await press(UP_CHORD);
    expect(jog).toHaveBeenCalledWith({ dy: -10, feed: 3000 }, undefined, { queueStep: true });

    await unmount();
  });

  it("uses the pad's current step and its feed clamped to the machine maximum", async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'front-left', maxFeed: 6000 });
    useJogControlPreferences.setState({ stepMm: 1, requestedFeedMmPerMin: 12000 });
    const { unmount } = await renderJogPad();

    await press(numpad('6'));
    await press(UP_CHORD);

    expect(jog.mock.calls).toEqual([
      [{ dx: 1, feed: 6000 }, undefined, { queueStep: true }],
      [{ dy: 1, feed: 6000 }, undefined, { queueStep: true }],
    ]);

    await unmount();
  });

  it('names the keys in each arrow tooltip', async () => {
    const { host, unmount } = await renderJogPad();

    expect(arrow(host, 'Jog +Y 10 mm').title).toContain('Ctrl+Shift+] or Numpad 8');
    expect(arrow(host, 'Jog -X 10 mm').title).toContain('Ctrl+Alt+[ or Numpad 4');
    expect(arrow(host, 'Jog +X -Y 10 mm').title).toContain('Numpad 3');
    expect(arrow(host, 'Jog +Y 10 mm').getAttribute('aria-label')).toBe('Jog +Y 10 mm');

    await unmount();
  });

  it('does nothing while the pad is disabled', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    const { unmount } = await renderJogPad(true);

    const chord = await press(LEFT_CHORD);
    await press(numpad('8'));

    expect(jog).not.toHaveBeenCalled();
    expect(chord.defaultPrevented).toBe(false);

    await unmount();
  });

  it('never jogs from a bare arrow or a NumLock-off keypad arrow', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    const { unmount } = await renderJogPad();

    await press({ key: 'ArrowUp', code: 'ArrowUp' });
    await press({ key: 'ArrowUp', code: 'Numpad8' });

    expect(jog).not.toHaveBeenCalled();

    await unmount();
  });

  it('never jogs a CNC from a NumLock-off keypad 9, 3, 1 or 7', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
    const { host, unmount } = await renderJogPad();

    for (const init of [
      numLockOff('9', 'PageUp'),
      numLockOff('3', 'PageDown'),
      numLockOff('1', 'End'),
      numLockOff('7', 'Home'),
    ]) {
      const event = await press(init);
      expect(event.defaultPrevented, init.code).toBe(false);
    }
    expect(jog).not.toHaveBeenCalled();

    // Z focus is live on a CNC: the dedicated key, with its Ctrl+Alt chord,
    // still jogs it, and the NumLock-on keypad 3 still sends what its +X -Y
    // arrow sends.
    await press({ key: 'PageDown', code: 'PageDown', ctrlKey: true, altKey: true });
    expect(jog).toHaveBeenCalledWith({ dz: -1, feed: 600 });
    jog.mockClear();
    await press(numpad('3'));
    await act(async () => arrow(host, 'Jog +X -Y 10 mm').click());
    expect(jog).toHaveBeenCalledTimes(2);
    expect(jog.mock.calls[0]).toEqual(jog.mock.calls[1]);

    await unmount();
  });

  it('stops listening once the pad unmounts', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    const { unmount } = await renderJogPad();
    await unmount();

    await press(numpad('8'));

    expect(jog).not.toHaveBeenCalled();
  });

  it('reports a refused keyboard jog the way an arrow click does', async () => {
    const jog = vi.fn(async () => {
      throw new Error('Machine must be known Idle.');
    });
    useLaserStore.setState({ jog });
    const { unmount } = await renderJogPad();

    await press(numpad('4'));

    await vi.waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
        'Jog: Machine must be known Idle.',
      ),
    );

    await unmount();
  });

  // Rolling audit v7 L8-P2-3: LightBurn's draw-order PgUp / PgDn sent a
  // connected CNC's bit one focus step. Only Ctrl+Alt+PgUp / PgDn jog Z now.
  it('jogs a CNC Z from Ctrl+Alt+PgDn only, never from a bare PgUp or PgDn', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
    const { unmount } = await renderJogPad();

    for (const key of ['PageUp', 'PageDown']) {
      const event = await press({ key, code: key });
      expect(event.defaultPrevented, key).toBe(false);
    }
    expect(jog).not.toHaveBeenCalled();

    await press({ key: 'PageDown', code: 'PageDown', ctrlKey: true, altKey: true });
    expect(jog).toHaveBeenCalledExactlyOnceWith({ dz: -1, feed: 600 });

    await unmount();
  });

  it('keeps Ctrl+Alt+PageUp jogging Z focus', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelMm: 75,
      zTravelConfirmed: true,
      maxFeed: 6000,
    });
    const { unmount } = await renderJogPad();

    await press({ key: 'PageUp', code: 'PageUp', ctrlKey: true, altKey: true });

    expect(jog).toHaveBeenCalledWith({ dz: 1, feed: 600 });

    await unmount();
  });
});
