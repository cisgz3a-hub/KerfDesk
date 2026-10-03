import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCommit } from './use-debounced-commit';

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

function Field(props: { value: number; commit: (value: number) => void; mapping?: string }) {
  const input = useDebouncedCommit({
    value: props.value,
    commit: props.commit,
    parse: Number,
    reconcileKey: props.mapping,
  });
  return (
    <input
      aria-label="Audit number"
      type="number"
      step="any"
      value={input.displayValue}
      onChange={input.onChange}
      onBlur={input.onBlur}
    />
  );
}

async function mount(value: number, commit = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.push({ host, root });
  const rerender = async (next: number, mapping?: string): Promise<void> => {
    await act(async () =>
      root.render(
        <Field value={next} commit={commit} {...(mapping === undefined ? {} : { mapping })} />,
      ),
    );
  };
  await rerender(value);
  const input = host.querySelector('input');
  if (input === null) throw new Error('Audit number missing');
  return { input, commit, rerender, root };
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

describe('small numeric audit: native validation and draft lifetime', () => {
  it('clears native invalidity immediately when an external numeric value replaces an invalid edit', async () => {
    const view = await mount(5);
    await change(view.input, '1e2');
    expect(view.input.validity.customError).toBe(true);
    await view.rerender(7);
    expect(view.input.value).toBe('7');
    expect(view.input.validity.customError).toBe(false);
    expect(view.input.checkValidity()).toBe(true);
    expect(view.commit).not.toHaveBeenCalled();
  });

  it('clears native invalidity when a display-mapping reset replaces the edit at the same value', async () => {
    const view = await mount(5);
    await change(view.input, '1e2');
    expect(view.input.validity.customError).toBe(true);
    await view.rerender(5, 'different owner');
    expect(view.input.value).toBe('5');
    expect(view.input.checkValidity()).toBe(true);
    expect(view.commit).not.toHaveBeenCalled();
  });

  it('keeps invalid numeric spelling uncommitted and accepts a corrected decimal without blur', async () => {
    const view = await mount(5);
    await change(view.input, '1e2');
    await act(async () => vi.advanceTimersByTime(400));
    expect(view.commit).not.toHaveBeenCalled();
    await change(view.input, '12.75');
    expect(view.input.checkValidity()).toBe(true);
    await act(async () => vi.advanceTimersByTime(400));
    expect(view.commit).toHaveBeenCalledExactlyOnceWith(12.75);
  });

  it('does not preserve an invalid exponent merely because it parses to the externally restored value', async () => {
    const view = await mount(5);
    await change(view.input, '5e1');
    expect(view.input.validity.customError).toBe(true);
    await view.rerender(50);
    expect(view.input.value).toBe('50');
    expect(view.input.checkValidity()).toBe(true);
    expect(view.commit).not.toHaveBeenCalled();
  });

  it('drops a scheduled valid number when its last digit is erased before the quiet period', async () => {
    const view = await mount(5);
    await change(view.input, '8');
    await change(view.input, '');
    await act(async () => vi.advanceTimersByTime(400));
    expect(view.commit).not.toHaveBeenCalled();
    expect(view.input.value).toBe('');
    await change(view.input, '4');
    await act(async () => Simulate.blur(view.input));
    expect(view.commit).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('retires a scheduled number on unmount without a ghost store write', async () => {
    const view = await mount(5);
    await change(view.input, '9');
    await act(async () => view.root.unmount());
    await act(async () => vi.advanceTimersByTime(400));
    expect(view.commit).not.toHaveBeenCalled();
  });
});
