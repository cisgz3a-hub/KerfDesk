import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberPairRow, type SetupNumberSpec } from './CncSetupRows';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

function spec(label: string, value: number, onCommit: (value: number) => void): SetupNumberSpec {
  return {
    label,
    value,
    min: -1_000,
    max: 1_000,
    step: 0.1,
    title: `Set ${label}`,
    onCommit,
  };
}

async function editAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}

describe('NumberPairRow', () => {
  it('keeps each prefix with a readable input while the value column wraps', async () => {
    const firstCommit = vi.fn();
    const secondCommit = vi.fn();
    const h = await render(
      <NumberPairRow
        label="Stock origin"
        unit="mm"
        prefixes={['X', 'Y']}
        first={spec('Stock origin X', 12, firstCommit)}
        second={spec('Stock origin Y', 34, secondCommit)}
      />,
    );

    expect(h.textContent).toContain('Stock origin (mm)');
    const inputs = Array.from(h.querySelectorAll('input'));
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual([
      'Stock origin X',
      'Stock origin Y',
    ]);

    const groups = inputs.map((input) => input.parentElement);
    expect(groups.every((group) => group instanceof HTMLSpanElement)).toBe(true);
    expect(groups.map((group) => group?.firstElementChild?.textContent)).toEqual(['X', 'Y']);
    expect(groups.map((group) => group?.style.minWidth)).toEqual(['75px', '75px']);
    expect(inputs.map((input) => input.style.minWidth)).toEqual(['64px', '64px']);

    const valueColumn = groups[0]?.parentElement;
    expect(valueColumn).toBeInstanceOf(HTMLDivElement);
    expect(valueColumn?.style.flexWrap).toBe('wrap');

    await editAndBlur(inputs[0] as HTMLInputElement, '125.5');
    expect(firstCommit).toHaveBeenCalledWith(125.5);
    expect(secondCommit).not.toHaveBeenCalled();

    await editAndBlur(inputs[1] as HTMLInputElement, '2000');
    expect(secondCommit).toHaveBeenCalledWith(1000);
    expect(firstCommit).toHaveBeenCalledTimes(1);
  });
});
