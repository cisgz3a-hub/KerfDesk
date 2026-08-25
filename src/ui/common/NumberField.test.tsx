import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function render(
  value: number,
  onCommit: (n: number) => void,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <NumberField
        ariaLabel="Test"
        value={value}
        min={0.1}
        max={100}
        step={0.1}
        onCommit={onCommit}
      />,
    );
  });
  return { host, root };
}

function field(host: HTMLElement): HTMLInputElement {
  const input = host.querySelector('input[aria-label="Test"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('field missing');
  return input;
}

describe('NumberField (clearable)', () => {
  it('holds an empty box on clear and restores on blur, without committing', async () => {
    const onCommit = vi.fn();
    const { host, root } = await render(5, onCommit);
    try {
      const input = field(host);
      input.value = '';
      await act(async () => Simulate.change(input));
      await act(async () => vi.advanceTimersByTime(400));
      expect(input.value).toBe('');
      expect(onCommit).not.toHaveBeenCalled();
      await act(async () => Simulate.blur(input));
      expect(field(host).value).toBe('5');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('commits a clamped number typed after clearing', async () => {
    const onCommit = vi.fn();
    const { host, root } = await render(5, onCommit);
    try {
      const input = field(host);
      input.value = '';
      await act(async () => Simulate.change(input));
      input.value = '20';
      await act(async () => Simulate.change(input));
      await act(async () => vi.advanceTimersByTime(400));
      expect(onCommit).toHaveBeenCalledWith(20);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
