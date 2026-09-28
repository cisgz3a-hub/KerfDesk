import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaterialTestDialog } from './MaterialTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('MaterialTestDialog settings to vary (ADR-497)', () => {
  it('swaps the other axis off a setting and generates what was chosen', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await choose(host, 'Rows vary', 'power');
      expect(select(host, 'Columns vary').value).toBe('speed');
      expect(inputLabels(host)).toEqual([
        'Rows',
        'Columns',
        'Min speed',
        'Max speed',
        'Min power',
        'Max power',
        'Passes',
        'Hatch spacing',
        'Cell width',
        'Cell height',
        'Gap',
      ]);
      expect(host.textContent).toContain('Burned column labels show effective feed.');

      await choose(host, 'Columns vary', 'passes');
      await type(host, 'Max passes', '4');
      await type(host, 'Speed', '2000');
      expect(host.textContent).toContain('Requested 2,000 mm/min');
      await clickGenerate(host);
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'fill',
          rowParameter: 'power',
          columnParameter: 'passes',
          passesMin: 1,
          passesMax: 4,
          speed: 2000,
        }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('cuts without hatch spacing', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await choose(host, 'Columns vary', 'interval');
      expect(inputLabels(host)).toContain('Min hatch spacing');
      await choose(host, 'Test', 'line');
      expect(select(host, 'Columns vary').value).toBe('power');
      expect(options(host, 'Columns vary')).toEqual(['speed', 'power', 'passes']);
      expect(inputLabels(host).some((label) => label.includes('atch spacing'))).toBe(false);
      await clickGenerate(host);
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'line', rowParameter: 'speed', columnParameter: 'power' }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('checks the ranges it shows', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await choose(host, 'Columns vary', 'passes');
      await type(host, 'Max passes', '25');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Max passes: enter 20 or less.',
      );
      await clickGenerate(host);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('says when the fastest cells need a longer runway than 5 mm', async () => {
    const { host, root } = await renderDialog(6000, 500);
    try {
      expect(host.textContent).not.toContain('of runway');
      await type(host, 'Max speed', '6000');
      expect(host.textContent).toContain('The fastest engraved cells need 11 mm of runway');
      await choose(host, 'Test', 'line');
      expect(host.textContent).not.toContain('of runway');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

async function renderDialog(
  maxFeedMmPerMin = 3000,
  accelMmPerSec2?: number,
): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
}> {
  const onGenerate = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MaterialTestDialog
        onCancel={vi.fn()}
        onGenerate={onGenerate}
        maxFeedMmPerMin={maxFeedMmPerMin}
        {...(accelMmPerSec2 === undefined ? {} : { accelMmPerSec2 })}
      />,
    );
  });
  return { host, root, onGenerate };
}

async function choose(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = select(host, label);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function type(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function clickGenerate(host: HTMLElement): Promise<void> {
  const generate = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Generate'),
  );
  if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  await act(async () => {
    generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return element;
}

function options(host: HTMLElement, label: string): ReadonlyArray<string> {
  return [...select(host, label).options].map((option) => option.value);
}

function inputLabels(host: HTMLElement): ReadonlyArray<string> {
  return [...host.querySelectorAll('input[type="number"]')].map(
    (element) => element.getAttribute('aria-label') ?? '',
  );
}
