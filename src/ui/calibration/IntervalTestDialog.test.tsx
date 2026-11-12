import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntervalTestDialog } from './IntervalTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  onGenerate = vi.fn(),
  onCancel = vi.fn(),
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: typeof onGenerate;
  readonly onCancel: typeof onCancel;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <IntervalTestDialog onCancel={onCancel} onGenerate={onGenerate} maxFeedMmPerMin={1000} />,
    );
  });
  return { host, root, onGenerate, onCancel };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('IntervalTestDialog', () => {
  it('renders interval controls and generates parsed options', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Interval Test');
      expect(host.textContent).toContain('Requested 1,500 mm/min; effective 1,000 mm/min');
      expect(host.textContent).toContain('burned speed label shows effective feed');
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

  it('restores the last generated interval test settings', async () => {
    const first = await renderDialog();
    try {
      const steps = input(first.host, 'Steps');
      const intervalMax = input(first.host, 'Max interval');
      await act(async () => {
        steps.value = '6';
        Simulate.change(steps);
        intervalMax.value = '0.24';
        Simulate.change(intervalMax);
      });
      await clickGenerate(first.host);
    } finally {
      await act(async () => first.root.unmount());
    }

    const second = await renderDialog();
    try {
      expect(input(second.host, 'Steps').value).toBe('6');
      expect(input(second.host, 'Max interval').value).toBe('0.24');
    } finally {
      await act(async () => second.root.unmount());
    }
  });

  // T02-P2-1 (tools audit T1): a 0.01 mm step refused the line pitches of
  // 400/300/200 DPI, which Cut Settings and the generator accept.
  it.each([
    ['0.0635', '0.127'],
    ['0.0508', '0.1016'],
    ['0.0847', '0.125'],
  ])('accepts DPI line pitches %s and %s mm', async (min, max) => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      const intervalMin = input(host, 'Min interval');
      const intervalMax = input(host, 'Max interval');
      await act(async () => {
        intervalMin.value = min;
        Simulate.change(intervalMin);
        intervalMax.value = max;
        Simulate.change(intervalMax);
      });
      expect(intervalMin.validity.stepMismatch).toBe(false);
      expect(intervalMax.validity.stepMismatch).toBe(false);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await clickGenerate(host);
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMinMm: Number(min), intervalMaxMm: Number(max) }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('still refuses an interval below the 0.05 mm floor', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      const intervalMin = input(host, 'Min interval');
      await act(async () => {
        intervalMin.value = '0.0499';
        Simulate.change(intervalMin);
      });
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Min interval: enter 0.05 or greater.',
      );
      await clickGenerate(host);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  // Gained via the kit Dialog migration (ADR-047): the calibration dialogs
  // previously lacked the Escape/focus-trap behavior every other modal had.
  it('closes on Escape', async () => {
    const { host, root, onCancel } = await renderDialog();
    try {
      const backdrop = host.querySelector('[role="dialog"]');
      await act(async () => {
        backdrop?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

async function clickGenerate(host: HTMLElement): Promise<void> {
  const generate = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Generate'),
  );
  if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  await act(async () => {
    generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return element;
}
