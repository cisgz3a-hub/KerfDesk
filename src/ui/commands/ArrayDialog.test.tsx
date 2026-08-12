import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrayDialog } from './ArrayDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ArrayDialog', () => {
  it('submits point rotation count and signed total angle', async () => {
    const onApply = vi.fn();
    await renderDialog({ onApply });

    const tabs = [...requiredHost().querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Grid', 'Point Rotation', 'Circular']);
    await act(async () => Simulate.click(button('Point Rotation')));
    expect(button('Point Rotation').getAttribute('aria-selected')).toBe('true');

    await setInput('Copies (includes original)', '5');
    await setInput('Total angle (deg)', '-180');
    const form = requiredHost().querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Array form missing');
    await act(async () => Simulate.submit(form));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'point-rotation',
      count: 5,
      totalAngleDeg: -180,
    });
  });

  it('cancels without applying an array', async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    await renderDialog({ onApply, onCancel });

    await act(async () => Simulate.click(button('Cancel')));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
});

async function renderDialog(props: {
  readonly onApply: React.ComponentProps<typeof ArrayDialog>['onApply'];
  readonly onCancel?: () => void;
}): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <ArrayDialog
        selectionBounds={{ minX: 10, minY: 20, maxX: 30, maxY: 40 }}
        onCancel={props.onCancel ?? vi.fn()}
        onApply={props.onApply}
      />,
    ),
  );
}

async function setInput(labelText: string, value: string): Promise<void> {
  const labels = [...requiredHost().querySelectorAll('label')];
  const label = labels.find((item) => item.textContent?.includes(labelText));
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${labelText} input missing`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('input value setter missing');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const candidate = [...requiredHost().querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return candidate;
}

function requiredHost(): HTMLDivElement {
  if (host === null) throw new Error('Dialog host missing');
  return host;
}
