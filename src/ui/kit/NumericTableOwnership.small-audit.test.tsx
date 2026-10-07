import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanOffsetPoint } from '../../core/devices';
import { ScanOffsetEditor } from '../laser/ScanOffsetEditor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const views: { host: HTMLDivElement; root: Root }[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const { host, root } of views.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
});

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.push({ host, root });
  const changes: ReadonlyArray<ScanOffsetPoint>[] = [];
  function Table(): JSX.Element {
    const [points, setPoints] = useState<ReadonlyArray<ScanOffsetPoint>>([
      { speedMmPerMin: 3000, offsetMm: 0.1 },
      { speedMmPerMin: 6000, offsetMm: 0.2 },
    ]);
    return (
      <ScanOffsetEditor
        value={points}
        maxOffsetMagnitudeMm={5}
        onChange={(next) => {
          changes.push(next);
          setPoints(next);
        }}
      />
    );
  }
  await act(async () => root.render(<Table />));
  return { host, changes };
}

function input(host: HTMLElement, name: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${name}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${name} missing`);
  return element;
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

describe('small numeric audit: rows which sort after an edit', () => {
  it('keeps the same scan-offset row and focus after Enter sorts the speeds', async () => {
    const view = await mount();
    const speed = input(view.host, 'Scan offset speed 1');
    speed.focus();
    await change(speed, '9000');
    await act(async () => vi.advanceTimersByTime(600));
    expect(view.changes).toHaveLength(0);
    await act(async () => Simulate.keyDown(speed, { key: 'Enter' }));
    expect(view.changes.at(-1)).toEqual([
      { speedMmPerMin: 6000, offsetMm: 0.2 },
      { speedMmPerMin: 9000, offsetMm: 0.1 },
    ]);
    expect(input(view.host, 'Scan offset speed 2')).toBe(speed);
    expect(document.activeElement).toBe(speed);
    await change(speed, '9500');
    await act(async () => Simulate.blur(speed));
    expect(view.changes.at(-1)).toEqual([
      { speedMmPerMin: 6000, offsetMm: 0.2 },
      { speedMmPerMin: 9500, offsetMm: 0.1 },
    ]);
  });

  it('retains the canonical later calibration when an edit creates a duplicate speed', async () => {
    const view = await mount();
    const speed = input(view.host, 'Scan offset speed 1');
    await change(speed, '6000');
    await act(async () => Simulate.keyDown(speed, { key: 'Enter' }));
    expect(view.changes.at(-1)).toEqual([{ speedMmPerMin: 6000, offsetMm: 0.2 }]);
    expect(input(view.host, 'Scan offset value 1').value).toBe('0.2');
    expect(view.host.querySelectorAll('input[aria-label^="Scan offset speed"]')).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(600));
    expect(view.changes).toHaveLength(1);
  });

  it('removes the intended row without first committing its unsaved speed and reordering it', async () => {
    const view = await mount();
    await change(input(view.host, 'Scan offset speed 1'), '9000');
    const button = view.host.querySelector('button[aria-label="Remove scan offset 1"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Remove row missing');
    const preventDefault = vi.fn();
    await act(async () => Simulate.pointerDown(button, { button: 0, preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    await act(async () => button.click());
    await act(async () => vi.advanceTimersByTime(600));
    expect(view.changes).toEqual([[{ speedMmPerMin: 6000, offsetMm: 0.2 }]]);
    expect(input(view.host, 'Scan offset speed 1').value).toBe('6000');
  });
});
