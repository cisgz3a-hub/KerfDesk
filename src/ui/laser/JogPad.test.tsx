import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JogPad } from './JogPad';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalJog = useLaserStore.getState().jog;

// jsdom's selector engine mis-parses '+' inside quoted attribute values, so
// queries scan getAttribute instead of using querySelector.
function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) ?? null
  );
}

async function renderJogPad(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JogPad disabled={false} />);
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
  useLaserStore.setState({ jog: originalJog });
  useStore.getState().newProject();
});

// Phase-0 discoverability: the arrow buttons were bare glyphs with no
// accessible name and no tooltip — screen readers announced "button" and
// sighted users had no step feedback.
describe('JogPad accessible labels', () => {
  it('labels each arrow with its direction and the current step', async () => {
    const { host, unmount } = await renderJogPad();

    expect(buttonByLabel(host, 'Jog +Y 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog -Y 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog -X 10 mm')).not.toBeNull();
    expect(buttonByLabel(host, 'Jog +X 10 mm')).not.toBeNull();

    await unmount();
  });

  it('updates the labels when the step changes', async () => {
    const { host, unmount } = await renderJogPad();

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Jog step size"]');
    if (select === null) throw new Error('step select missing');
    await act(async () => {
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(buttonByLabel(host, 'Jog +Y 1 mm')).not.toBeNull();

    await unmount();
  });

  it('offers fine, medium, and coarse jog distances', async () => {
    const { host, unmount } = await renderJogPad();

    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Jog step size"]');
    if (select === null) throw new Error('step select missing');
    expect([...select.options].map((option) => option.value)).toEqual([
      '0.1',
      '0.5',
      '1',
      '2',
      '5',
      '10',
      '25',
      '50',
      '100',
    ]);

    await unmount();
  });

  it('shows manual focus guidance when the active profile has no powered Z axis', async () => {
    const { host, unmount } = await renderJogPad();

    expect(host.textContent).toContain('Manual focus: adjust the laser head by hand.');
    expect(buttonByLabel(host, 'Jog Z+ 1 mm')).toBeNull();

    await unmount();
  });

  it('blocks Z jog buttons until Z travel has been confirmed', async () => {
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelMm: 75,
      zTravelConfirmed: false,
    });
    const { host, unmount } = await renderJogPad();

    const zUp = buttonByLabel(host, 'Jog Z+ 1 mm');
    const zDown = buttonByLabel(host, 'Jog Z- 1 mm');
    expect(zUp?.disabled).toBe(true);
    expect(zDown?.disabled).toBe(true);
    expect(host.textContent).toContain('Confirm Z travel in Machine Setup before using Z jog.');

    await unmount();
  });

  it('blocks Z jog buttons when a stale confirmation has no positive travel value', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelConfirmed: true,
      maxFeed: 6000,
    });
    const { host, unmount } = await renderJogPad();

    const zUp = buttonByLabel(host, 'Jog Z+ 1 mm');
    if (zUp === null) throw new Error('Z+ jog button missing');
    expect(zUp.disabled).toBe(true);

    await act(async () => {
      zUp.click();
    });

    expect(jog).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Confirm Z travel in Machine Setup before using Z jog.');

    await unmount();
  });

  // The arrows are physical directions (↑ = away from the operator). On
  // rear-*/right-origin machines the machine axes point the other way, so the
  // emitted deltas — and the labels, which describe the wire command — must
  // flip with the device origin. A hardcoded +Y for ↑ rams the head into the
  // front rail on a rear-origin machine.
  it('flips Y for ↑ on a rear-left origin machine', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'rear-left', maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();

    const up = buttonByLabel(host, 'Jog -Y 10 mm');
    if (up === null) throw new Error('↑ button missing its origin-corrected -Y label');
    await act(async () => {
      up.click();
    });
    expect(jog).toHaveBeenCalledWith({ dy: -10, feed: 3000 });

    const right = buttonByLabel(host, 'Jog +X 10 mm');
    if (right === null) throw new Error('→ button missing its +X label');
    await act(async () => {
      right.click();
    });
    expect(jog).toHaveBeenLastCalledWith({ dx: 10, feed: 3000 });

    await unmount();
  });

  it('flips both axes on a rear-right origin machine', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ origin: 'rear-right', maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();

    const up = buttonByLabel(host, 'Jog -Y 10 mm');
    const right = buttonByLabel(host, 'Jog -X 10 mm');
    if (up === null || right === null) throw new Error('origin-corrected labels missing');
    await act(async () => {
      up.click();
    });
    expect(jog).toHaveBeenCalledWith({ dy: -10, feed: 3000 });
    await act(async () => {
      right.click();
    });
    expect(jog).toHaveBeenLastCalledWith({ dx: -10, feed: 3000 });

    await unmount();
  });

  it('keeps the front-left mapping for ↑ and →', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({ maxFeed: 6000 });
    const { host, unmount } = await renderJogPad();

    const up = buttonByLabel(host, 'Jog +Y 10 mm');
    if (up === null) throw new Error('↑ button missing its +Y label');
    await act(async () => {
      up.click();
    });
    expect(jog).toHaveBeenCalledWith({ dy: 10, feed: 3000 });

    await unmount();
  });

  it('sends relative Z jogs only for confirmed Z-axis profiles', async () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({ jog });
    useStore.getState().updateDeviceProfile({
      capabilities: ['grbl', 'z-axis'],
      zTravelMm: 75,
      zTravelConfirmed: true,
      maxFeed: 6000,
    });
    const { host, unmount } = await renderJogPad();

    const zUp = buttonByLabel(host, 'Jog Z+ 1 mm');
    if (zUp === null) throw new Error('Z+ jog button missing');
    await act(async () => {
      zUp.click();
    });

    expect(jog).toHaveBeenCalledWith({ dz: 1, feed: 600 });

    await unmount();
  });
});
