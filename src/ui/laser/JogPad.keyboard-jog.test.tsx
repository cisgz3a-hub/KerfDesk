// Keyboard XY jog wiring (LightBurn gap LBG-M07, ADR-483). The jog pad installs
// the keys while it is mounted, so the oracle is what the pad sends through the
// store's jog action: the SAME vector its matching on-screen arrow sends (origin
// signs, step, clamped feed), nothing while the pad is disabled or unmounted,
// and a refusal reported the way an arrow click reports it.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
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

function arrow(host: HTMLElement, glyph: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === glyph);
  if (button === undefined) throw new Error(`jog arrow ${glyph} missing`);
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

describe('JogPad keyboard XY jog (ADR-483)', () => {
  it('sends exactly what the matching arrow sends on a rear-right machine', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'rear-right', maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();

    const pairs: ReadonlyArray<readonly [KeyboardEventInit, string]> = [
      [UP_CHORD, '↑'],
      [DOWN_CHORD, '↓'],
      [LEFT_CHORD, '←'],
      [RIGHT_CHORD, '→'],
      [numpad('8'), '↑'],
      [numpad('7'), '↖'],
      [numpad('3'), '↘'],
    ];
    for (const [init, glyph] of pairs) {
      jog.mockClear();
      const event = await press(init);
      await act(async () => arrow(host, glyph).click());
      expect(jog).toHaveBeenCalledTimes(2);
      expect(jog.mock.calls[0], glyph).toEqual(jog.mock.calls[1]);
      expect(event.defaultPrevented).toBe(true);
    }
    // Physical up on a rear-origin machine is machine -Y (the pad's own label).
    jog.mockClear();
    await press(UP_CHORD);
    expect(jog).toHaveBeenCalledWith({ dy: -10, feed: 3000 });

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

    expect(jog.mock.calls).toEqual([[{ dx: 1, feed: 6000 }], [{ dy: 1, feed: 6000 }]]);

    await unmount();
  });

  it('names the keys in each arrow tooltip', async () => {
    const { host, unmount } = await renderJogPad();

    expect(arrow(host, '↑').title).toContain('Ctrl+Shift+] or Numpad 8');
    expect(arrow(host, '←').title).toContain('Ctrl+Alt+[ or Numpad 4');
    expect(arrow(host, '↘').title).toContain('Numpad 3');
    expect(arrow(host, '↑').getAttribute('aria-label')).toBe('Jog +Y 10 mm');

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

  it('keeps PageUp jogging Z focus', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelMm: 75,
      zTravelConfirmed: true,
      maxFeed: 6000,
    });
    const { unmount } = await renderJogPad();

    await press({ key: 'PageUp', code: 'PageUp' });

    expect(jog).toHaveBeenCalledWith({ dz: 1, feed: 600 });

    await unmount();
  });
});
