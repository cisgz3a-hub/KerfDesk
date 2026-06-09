import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntervalTestDialog } from './IntervalTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(onGenerate = vi.fn()): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: typeof onGenerate;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<IntervalTestDialog onCancel={vi.fn()} onGenerate={onGenerate} />);
  });
  return { host, root, onGenerate };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('IntervalTestDialog', () => {
  it('renders interval controls and generates parsed options', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Interval Test');
      const steps = input(host, 'Steps');
      const intervalMax = input(host, 'Max interval');
      await act(async () => {
        steps.value = '4';
        Simulate.change(steps);
        intervalMax.value = '0.25';
        Simulate.change(intervalMax);
      });

      const generate = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Generate'),
      );
      if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
      await act(async () => {
        generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ steps: 4, intervalMaxMm: 0.25 }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return element;
}
