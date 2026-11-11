// Annoyance audit A4-P2-2: Enter in a number field commits the value and lets
// go of the keyboard, so the design shortcuts work again without a canvas click.

import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftNumberInput } from './DraftNumberInput';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const views: { host: HTMLDivElement; root: Root }[] = [];

afterEach(async () => {
  for (const { host, root } of views.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

async function mount(node: ReactNode): Promise<HTMLInputElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  views.push({ host, root });
  await act(async () => root.render(node));
  const input = host.querySelector('input');
  if (input === null) throw new Error('number field missing');
  return input;
}

function Field(props: { readonly commit: (value: number) => void }): JSX.Element {
  const [value, setValue] = useState(10);
  return (
    <DraftNumberInput
      aria-label="Width"
      value={value}
      onValueChange={(next) => {
        props.commit(next);
        setValue(next);
      }}
    />
  );
}

async function typeAndPress(
  input: HTMLInputElement,
  text: string,
  code: 'Enter' | 'NumpadEnter',
): Promise<void> {
  await act(async () => {
    input.focus();
    input.value = text;
    Simulate.change(input);
  });
  // Simulate copies every property onto the event; its type omits `code`.
  const enter = { key: 'Enter', code };
  await act(async () => {
    Simulate.keyDown(input, enter);
  });
}

describe('DraftNumberInput Enter (A4-P2-2)', () => {
  it('commits the value and releases focus', async () => {
    const commit = vi.fn();
    const input = await mount(<Field commit={commit} />);
    await typeAndPress(input, '25', 'Enter');
    expect(commit).toHaveBeenLastCalledWith(25);
    expect(document.activeElement).not.toBe(input);
    expect(input.value).toBe('25');
  });

  it('keeps focus on keypad Enter, where the next keypad digit must not jog the machine', async () => {
    const commit = vi.fn();
    const input = await mount(<Field commit={commit} />);
    await typeAndPress(input, '25', 'NumpadEnter');
    expect(commit).toHaveBeenLastCalledWith(25);
    expect(document.activeElement).toBe(input);
  });

  it('keeps focus inside a dialog, which owns the keyboard', async () => {
    const commit = vi.fn();
    const input = await mount(
      <div role="dialog" aria-label="Settings">
        <Field commit={commit} />
      </div>,
    );
    await typeAndPress(input, '25', 'Enter');
    expect(commit).toHaveBeenLastCalledWith(25);
    expect(document.activeElement).toBe(input);
  });

  it('keeps focus in a commit-on-blur table row, whose Enter sorts the rows', async () => {
    const commit = vi.fn();
    const input = await mount(
      <DraftNumberInput aria-label="Speed" value={10} commitOnBlur onValueChange={commit} />,
    );
    await typeAndPress(input, '25', 'Enter');
    expect(commit).toHaveBeenLastCalledWith(25);
    expect(document.activeElement).toBe(input);
  });

  it('keeps focus when the caller took Enter for itself', async () => {
    const input = await mount(
      <DraftNumberInput
        aria-label="Width"
        value={10}
        onValueChange={() => undefined}
        onKeyDown={(event) => event.preventDefault()}
      />,
    );
    await typeAndPress(input, '25', 'Enter');
    expect(document.activeElement).toBe(input);
  });
});
