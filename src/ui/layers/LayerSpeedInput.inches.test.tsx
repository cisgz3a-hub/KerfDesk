import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speedSliderRange, speedSliderStops } from '../../core/devices/working-speed-range';
import { createLayer } from '../../core/scene';
import { useStore } from '../state';
import { useDisplayUnitsStore } from '../state/display-units';
import { resetStore } from '../state/test-helpers';
import type { FeedCeiling } from './feed-ceiling';
import { SpeedInput } from './LayerSpeedInput';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const layer = createLayer({ id: 'layer-1', name: 'Engrave', color: '#ff0000' });

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useDisplayUnitsStore.setState({ lengthUnit: 'in' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  useDisplayUnitsStore.setState({ lengthUnit: 'mm' });
  resetStore();
});

async function renderSpeed(speed: number, commit = vi.fn(), observe = vi.fn()) {
  const ceiling: FeedCeiling = { maxFeed: 6000, request: null, observe };
  await act(async () =>
    root.render(
      <SpeedInput
        layer={layer}
        ceiling={ceiling}
        operationTarget={{
          settings: { ...layer, speed },
          selectedObjectCount: 1,
          reconcileKey: 'initial',
          commit,
        }}
      />,
    ),
  );
  const number = host.querySelector('input[aria-label="Speed for Engrave"]');
  if (!(number instanceof HTMLInputElement)) throw new Error('Speed box missing');
  return { number, commit, observe };
}

describe('laser Speed in inches (ADR-629)', () => {
  it.each(['10mm', '10mm/min'])(
    'honours explicit %s without applying the inch scale twice',
    async (text) => {
      const { number, commit, observe } = await renderSpeed(1524);
      await act(async () => {
        number.value = text;
        Simulate.change(number);
      });
      await act(async () => Simulate.blur(number));
      expect(commit).toHaveBeenLastCalledWith({ speed: 10 });
      expect(observe).toHaveBeenLastCalledWith('10');
    },
  );

  it('does not commit a partially parsed value with an unknown unit', async () => {
    const { number, commit } = await renderSpeed(1524);
    await act(async () => {
      number.value = '10mystery';
      Simulate.change(number);
    });
    await act(async () => Simulate.blur(number));
    await act(async () => vi.advanceTimersByTime(400));
    expect(commit).not.toHaveBeenCalled();
    expect(number.validity.valid).toBe(false);
  });

  it('shows in/min and an in/s reading', async () => {
    const { number } = await renderSpeed(1524);
    expect(number.value).toBe('60');
    expect(host.textContent).toContain('in/min');
    expect(host.textContent).toContain('1 in/s');
  });

  it('commits a typed in/min speed as mm/min and tells the ceiling in mm/min', async () => {
    const { number, commit, observe } = await renderSpeed(1524);
    await act(async () => {
      number.value = '100';
      Simulate.change(number);
    });
    await act(async () => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenLastCalledWith({ speed: 2540 });
    expect(observe).toHaveBeenLastCalledWith('2540');
  });

  it('commits each slider stop as the exact mm/min speed it names', async () => {
    const { device } = useStore.getState().project;
    const stops = speedSliderStops(
      speedSliderRange({
        profileId: device.profileId,
        laserSubProfile: device.laserSubProfile,
        maxFeed: 6000,
      }),
    );
    const { commit } = await renderSpeed(1524);
    const slider = host.querySelector('input[aria-label="Speed slider for Engrave"]');
    if (!(slider instanceof HTMLInputElement)) throw new Error('Speed slider missing');
    for (const [index, stop] of stops.entries()) {
      await act(async () => {
        slider.value = String(index);
        Simulate.change(slider);
      });
      await act(async () => vi.advanceTimersByTime(400));
      expect(commit).toHaveBeenLastCalledWith({ speed: stop });
    }
  });

  it('stays a spin button whose arrows step the speed by 1 in/min', async () => {
    const { number, commit } = await renderSpeed(1524);
    expect(number.type).toBe('text');
    expect(number.getAttribute('role')).toBe('spinbutton');
    expect(number.getAttribute('aria-valuenow')).toBe('60');
    await act(async () => Simulate.keyDown(number, { key: 'ArrowUp' }));
    expect(number.value).toBe('61');
    await act(async () => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenLastCalledWith({ speed: 1549.4 });
  });

  it('writes nothing back when a rounded speed is left unedited', async () => {
    const { number, commit } = await renderSpeed(1500);
    expect(number.value).toBe('59.1');
    await act(async () => Simulate.blur(number));
    await act(async () => vi.advanceTimersByTime(400));
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('Speed tooltip (UX audit U3-P3-1)', () => {
  it('says what speed does before its unit', async () => {
    const { number } = await renderSpeed(1524);
    expect(number.title).toMatch(
      /^Speed: how fast the head moves while the laser fires. Slower burns darker/,
    );
    expect(number.title).toContain('Feed rate in in/min.');
  });
});
