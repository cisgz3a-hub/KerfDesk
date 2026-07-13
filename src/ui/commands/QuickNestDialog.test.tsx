import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickNestDialog } from './QuickNestDialog';

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

describe('QuickNestDialog', () => {
  it('defaults to outline nesting and submits an explicit method choice', async () => {
    const onApply = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(<QuickNestDialog boardAvailable onCancel={vi.fn()} onApply={onApply} />),
    );

    expect(button('Outline').getAttribute('aria-pressed')).toBe('true');
    await act(async () => Simulate.click(button('Fast')));
    expect(button('Fast').getAttribute('aria-pressed')).toBe('true');
    const form = host.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Quick Nest form missing');
    await act(async () => Simulate.submit(form));

    expect(onApply).toHaveBeenCalledWith({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      method: 'fast',
    });
  });
});

function button(label: string): HTMLButtonElement {
  const candidate = Array.from(host?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return candidate;
}
