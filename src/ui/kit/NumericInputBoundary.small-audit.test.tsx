import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from '../common/NumberField';
import { DraftNumberInput } from './DraftNumberInput';

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

async function mount(node: ReactNode): Promise<HTMLInputElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.push({ host, root });
  await act(async () => root.render(node));
  const input = host.querySelector('input');
  if (input === null) throw new Error('Numeric audit input missing');
  return input;
}

async function change(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    Simulate.change(input);
  });
}

function DeferredField(props: {
  initial?: number;
  commit: (value: number) => void;
  preventEnter?: boolean;
  normalize?: (value: number) => number;
}): JSX.Element {
  const [value, setValue] = useState(props.initial ?? 3000);
  return (
    <DraftNumberInput
      aria-label="Deferred edit"
      value={value}
      commitOnBlur
      {...(props.normalize === undefined ? {} : { normalize: props.normalize })}
      onValueChange={(next) => {
        props.commit(next);
        setValue(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && props.preventEnter) event.preventDefault();
      }}
    />
  );
}

describe('small numeric audit: boundary and completion scenarios', () => {
  it('rejects exponent notation without committing the parseFloat prefix in an English decimal field', async () => {
    const commit = vi.fn();
    const input = await mount(
      <NumberField ariaLabel="Decimal" value={5} min={0} max={100} onCommit={commit} />,
    );
    await change(input, '12e1');
    await act(async () => vi.advanceTimersByTime(400));
    await act(async () => Simulate.blur(input));
    expect(commit).not.toHaveBeenCalled();
    expect(input.value).toBe('12e1');
    expect(input.validity.customError).toBe(true);
    await change(input, '12.5');
    await act(async () => Simulate.blur(input));
    expect(commit).toHaveBeenCalledExactlyOnceWith(12.5);
    expect(input.validity.customError).toBe(false);
  });

  it('keeps a saved tiny canonical value unchanged when focus leaves without an edit', async () => {
    const commit = vi.fn();
    const input = await mount(
      <NumberField ariaLabel="Tiny" value={1e-7} positiveOnly onCommit={commit} />,
    );
    await act(async () => Simulate.blur(input));
    expect(input.value).toBe('1e-7');
    expect(commit).not.toHaveBeenCalled();
  });

  it('never commits zero or a negative value into a positive-only field and can still be corrected', async () => {
    const commit = vi.fn();
    const input = await mount(
      <NumberField ariaLabel="Positive" value={5} positiveOnly onCommit={commit} />,
    );
    for (const text of ['0', '-0.25']) {
      await change(input, text);
      await act(async () => vi.advanceTimersByTime(400));
      await act(async () => Simulate.blur(input));
      expect(input.value).toBe('5');
      expect(commit).not.toHaveBeenCalled();
    }
    await change(input, '0.125');
    await act(async () => Simulate.blur(input));
    expect(commit).toHaveBeenCalledExactlyOnceWith(0.125);
  });

  it('commits a deferred number once on Enter and accepts another edit without moving focus', async () => {
    const commit = vi.fn();
    const input = await mount(<DeferredField commit={commit} />);
    await change(input, '8000');
    await act(async () => vi.advanceTimersByTime(600));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    expect(commit).toHaveBeenCalledExactlyOnceWith(8000);
    await change(input, '800');
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    await act(async () => Simulate.blur(input));
    expect(commit.mock.calls).toEqual([[8000], [800]]);
    expect(input.value).toBe('800');
  });

  it('lets the caller own Enter without silently committing a deferred edit', async () => {
    const commit = vi.fn();
    const input = await mount(<DeferredField commit={commit} preventEnter />);
    await change(input, '5000');
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    await act(async () => vi.advanceTimersByTime(600));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => Simulate.blur(input));
    expect(commit).toHaveBeenCalledExactlyOnceWith(5000);
  });

  it('restores an abandoned blank deferred edit on Enter without committing a fallback', async () => {
    const commit = vi.fn();
    const input = await mount(<DeferredField commit={commit} />);
    await change(input, '');
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    expect(input.value).toBe('3000');
    expect(commit).not.toHaveBeenCalled();
  });

  it('preserves the owning finite-number rule when a normalizer returns a non-finite result', async () => {
    const commit = vi.fn();
    const input = await mount(<DeferredField commit={commit} normalize={() => NaN} />);
    await change(input, '4000');
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    expect(input.value).toBe('3000');
    expect(commit).not.toHaveBeenCalled();
  });
});
