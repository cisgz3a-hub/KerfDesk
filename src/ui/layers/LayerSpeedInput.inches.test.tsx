import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
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
  const number = host.querySelector('input[type="number"]');
  if (!(number instanceof HTMLInputElement)) throw new Error('Speed box missing');
  return { number, commit, observe };
}

describe('laser Speed in inches (ADR-629)', () => {
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

  it('writes nothing back when a rounded speed is left unedited', async () => {
    const { number, commit } = await renderSpeed(1500);
    expect(number.value).toBe('59.1');
    await act(async () => Simulate.blur(number));
    await act(async () => vi.advanceTimersByTime(400));
    expect(commit).not.toHaveBeenCalled();
  });
});
