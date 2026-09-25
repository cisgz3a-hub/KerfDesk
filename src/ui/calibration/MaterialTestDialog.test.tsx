import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import { generateMaterialTestAxesGrid } from '../../core/job/material-test-axes-grid';
import { generateMaterialTestGrid } from '../../core/job/material-test-grid';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { MaterialTestDialog } from './MaterialTestDialog';
import type { MaterialTestRequest } from './material-test-draft';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  onGenerate = vi.fn<(request: MaterialTestRequest) => void>(),
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
      <MaterialTestDialog onCancel={onCancel} onGenerate={onGenerate} maxFeedMmPerMin={3000} />,
    );
  });
  return { host, root, onGenerate, onCancel };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('MaterialTestDialog', () => {
  it('renders axis controls and generates the parsed request', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Material Test');
      expect(host.textContent).toContain('10 × 10 = 100 cells.');
      expect(host.textContent).toContain('effective 1,000–3,000 mm/min');
      await setValue(host, 'Rows', '2');
      await setValue(host, 'Row start', '3500');
      expect(host.textContent).toContain('Requested 1,000–3,500 mm/min');
      expect(host.textContent).toContain('Burned speed labels show effective feed');

      await clickGenerate(host);

      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          placement: 'insert',
          options: expect.objectContaining({
            mode: 'fill',
            rowAxis: { parameter: 'speed', start: 3500, end: 1000, count: 2 },
            columnAxis: { parameter: 'power', start: 10, end: 40, count: 10 },
          }),
        }),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  // ADR-381: with its defaults untouched the dialog asks for exactly the
  // ADR-044 speed x power test, so the burned grid and its G-code are the
  // ones operators already calibrated against.
  it('generates the ADR-044 grid byte for byte when left at its defaults', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await clickGenerate(host);
    } finally {
      await act(async () => root.unmount());
    }
    const request = onGenerate.mock.calls[0]?.[0];
    if (request === undefined) throw new Error('no request');
    const current = generateMaterialTestAxesGrid({ ...request.options, maxFeedMmPerMin: 3000 });
    const adr044 = generateMaterialTestGrid({
      rows: 10,
      columns: 10,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 5,
      gapMm: 1,
      maxFeedMmPerMin: 3000,
    });
    expect(JSON.stringify(current.scene)).toBe(JSON.stringify(adr044.scene));
    const emit = (scene: typeof current.scene): string =>
      grblStrategy.emit(compileJob(scene, DEFAULT_DEVICE_PROFILE), DEFAULT_DEVICE_PROFILE);
    expect(emit(current.scene)).toBe(emit(adr044.scene));
  });

  it('restores the last generated settings, placement included', async () => {
    const first = await renderDialog();
    try {
      await setValue(first.host, 'Rows', '3');
      await setValue(first.host, 'Row start', '4200');
      await act(async () => {
        const radio = first.host.querySelector<HTMLInputElement>('input[value="new-project"]');
        radio?.click();
      });
      await clickGenerate(first.host);
      expect(first.onGenerate.mock.calls[0]?.[0].placement).toBe('new-project');
    } finally {
      await act(async () => first.root.unmount());
    }

    const second = await renderDialog();
    try {
      expect(input(second.host, 'Rows').value).toBe('3');
      expect(input(second.host, 'Row start').value).toBe('4200');
      const radio = second.host.querySelector<HTMLInputElement>('input[value="new-project"]');
      expect(radio?.checked).toBe(true);
    } finally {
      await act(async () => second.root.unmount());
    }
  });

  it('carries a pre-axes speed x power draft into the new axes', async () => {
    localStorage.setItem(
      'laserforge.calibration.materialTestDraft.v1',
      JSON.stringify({
        schemaVersion: 1,
        draft: {
          rows: '4',
          columns: '5',
          speedMin: '800',
          speedMax: '2400',
          powerMin: '15',
          powerMax: '35',
          cellWidthMm: '6',
          cellHeightMm: '4',
          gapMm: '2',
        },
      }),
    );
    const { host, root } = await renderDialog();
    try {
      expect(select(host, 'Rows vary').value).toBe('speed');
      expect(input(host, 'Row start').value).toBe('2400');
      expect(input(host, 'Row end').value).toBe('800');
      expect(input(host, 'Rows').value).toBe('4');
      expect(select(host, 'Columns vary').value).toBe('power');
      expect(input(host, 'Column start').value).toBe('15');
      expect(input(host, 'Column end').value).toBe('35');
      expect(input(host, 'Columns').value).toBe('5');
      expect(input(host, 'Cell width').value).toBe('6');
      expect(input(host, 'Gap').value).toBe('2');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('swaps the axes when a row picks the setting the columns vary', async () => {
    const { host, root } = await renderDialog();
    try {
      await setValue(host, 'Rows vary', 'power', 'select');
      expect(select(host, 'Columns vary').value).toBe('speed');
      expect(input(host, 'Row start').value).toBe('10');
      expect(input(host, 'Row end').value).toBe('40');
      expect(input(host, 'Column start').value).toBe('3000');
      expect(input(host, 'Column end').value).toBe('1000');
      // Neither axis varies passes or interval, so both are set per test.
      expect(input(host, 'Passes').value).toBe('1');
      expect(input(host, 'Interval').value).toBe('0.1');
      expect(host.querySelector('input[aria-label="Power"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('resets a newly chosen axis setting to its own range', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await setValue(host, 'Rows vary', 'passes', 'select');
      expect(input(host, 'Row start').value).toBe('1');
      expect(input(host, 'Row end').value).toBe('4');
      expect(host.textContent).toContain('4 × 10 = 40 cells.');
      expect(input(host, 'Speed').value).toBe('1500');
      await clickGenerate(host);
      expect(onGenerate.mock.calls[0]?.[0].options).toMatchObject({
        rowAxis: { parameter: 'passes', start: 1, end: 4, count: 10 },
        base: { speed: 1500, passes: 1 },
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('refuses an interval axis in Line mode', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await setValue(host, 'Rows vary', 'interval', 'select');
      await setValue(host, 'Test mode', 'line', 'select');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Interval can only be tested in Fill or Image mode.',
      );
      const generate = generateButton(host);
      expect(generate.disabled).toBe(true);
      await act(async () => Simulate.submit(host.querySelector('form') as HTMLFormElement));
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('asks for grayscale images and bounds the image interval', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await setValue(host, 'Test mode', 'image-grayscale', 'select');
      expect(host.textContent).toContain('five-step gray ramp');
      await setValue(host, 'Interval', '0.5');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        'Interval: enter 0.2 or less.',
      );
      await setValue(host, 'Interval', '0.08');
      await clickGenerate(host);
      expect(onGenerate.mock.calls[0]?.[0].options).toMatchObject({
        mode: 'image',
        base: { ditherAlgorithm: 'grayscale', intervalMm: 0.08 },
      });
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('hands labels, border and air assist through', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      await toggle(host, 'Burn value labels');
      await toggle(host, 'Border around the test');
      await toggle(host, 'Air assist');
      await clickGenerate(host);
      expect(onGenerate.mock.calls[0]?.[0].options).toMatchObject({
        labels: false,
        border: true,
        base: { airAssist: true },
      });
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

function generateButton(host: HTMLElement): HTMLButtonElement {
  const generate = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Generate'),
  );
  if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  return generate;
}

async function clickGenerate(host: HTMLElement): Promise<void> {
  const generate = generateButton(host);
  await act(async () => {
    generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function setValue(
  host: HTMLElement,
  label: string,
  value: string,
  kind: 'input' | 'select' = 'input',
): Promise<void> {
  const element = kind === 'input' ? input(host, label) : select(host, label);
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function toggle(host: HTMLElement, label: string): Promise<void> {
  await act(async () => input(host, label).click());
}

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return element;
}

function select(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return element;
}
