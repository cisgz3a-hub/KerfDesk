import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { RotaryTurnJogControls, rotaryTurnJogMm } from './RotaryTurnJogControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Rolling audit v12 X8-P3-4: with the Creality chuck (40 machine mm per turn)
// a 10 mm Y jog turned the part 90°. The rotary row turns it by degrees.

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};
const originalProject = useStore.getState().project;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.setState({ project: originalProject });
});

async function render(rotary: RotarySetup | undefined, onJog = vi.fn()) {
  useStore.setState({
    project: createProject(
      rotary === undefined ? DEFAULT_DEVICE_PROFILE : { ...DEFAULT_DEVICE_PROFILE, rotary },
    ),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<RotaryTurnJogControls disabled={false} feed={3000} onJog={onJog} />);
  });
  return { host, onJog };
}

function button(label: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll('button') ?? [])].find(
    (b) => b.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`No button ${label}`);
  return found;
}

describe('RotaryTurnJogControls', () => {
  it('converts degrees to the machine Y of one turn of the part', () => {
    expect(rotaryTurnJogMm(90, 40, false)).toBe(10);
    expect(rotaryTurnJogMm(15, 40, true)).toBeCloseTo(-40 / 24, 12);
  });

  it('is absent without an active rotary', async () => {
    await render(undefined);
    expect(host?.textContent).toBe('');
    await act(async () => root?.unmount());
    root = null;
    await render({ ...CHUCK, enabled: false });
    expect(host?.textContent).toBe('');
  });

  it('turns the chuck 15° per click and names the surface it moves', async () => {
    const { onJog } = await render(CHUCK);
    expect(host?.textContent).toContain('= 10.47 mm of surface');
    await act(async () => button('Turn the part +15°').click());
    await act(async () => button('Turn the part −15°').click());
    expect(onJog).toHaveBeenNthCalledWith(1, { dy: expect.closeTo(40 / 24, 9), feed: 3000 });
    expect(onJog).toHaveBeenNthCalledWith(2, { dy: expect.closeTo(-40 / 24, 9), feed: 3000 });
  });

  it('turns a reversed rotary the way the job turns it', async () => {
    const { onJog } = await render({ ...CHUCK, reverseAxis: true });
    await act(async () => button('Turn the part +15°').click());
    expect(onJog).toHaveBeenCalledWith({ dy: expect.closeTo(-40 / 24, 9), feed: 3000 });
  });
});
