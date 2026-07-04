import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeneratorDialog } from './BoxGeneratorDialog';
import type { BoxMachineContext } from './box-draft';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LASER: BoxMachineContext = { kind: 'laser' };
const CNC: BoxMachineContext = { kind: 'cnc', stockThicknessMm: 6, toolDiameterMm: 3.175 };

async function renderDialog(machine: BoxMachineContext = LASER): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
  readonly onGenerate: ReturnType<typeof vi.fn>;
  readonly onCancel: ReturnType<typeof vi.fn>;
}> {
  const onGenerate = vi.fn();
  const onCancel = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <BoxGeneratorDialog machine={machine} onCancel={onCancel} onGenerate={onGenerate} />,
    );
  });
  return { host, root, onGenerate, onCancel };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

function input(host: HTMLElement, label: string): HTMLInputElement {
  const element = host.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return element;
}

function generateButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Generate'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Generate button missing');
  return button;
}

function selectEl(host: HTMLElement, label: string): HTMLSelectElement {
  const element = host.querySelector(`select[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} select missing`);
  return element;
}

async function setSelect(host: HTMLElement, label: string, value: string): Promise<void> {
  const element = selectEl(host, label);
  element.value = value;
  await act(async () => {
    Simulate.change(element);
  });
}

describe('BoxGeneratorDialog', () => {
  it('generates six laser panels from the defaults', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Box Generator');
      expect(host.textContent).toContain('Outer 66 × 46 × 36 mm');
      expect(generateButton(host).disabled).toBe(false);
      await act(async () => {
        generateButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onGenerate).toHaveBeenCalledTimes(1);
      const panels = onGenerate.mock.calls[0]?.[0] as ReadonlyArray<{ name: string }>;
      expect(panels.map((panel) => panel.name)).toEqual([
        'Bottom',
        'Top',
        'Front',
        'Back',
        'Left',
        'Right',
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('disables Generate and reports the field for an empty dimension', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      const width = input(host, 'Width');
      await act(async () => {
        width.value = '';
        Simulate.change(width);
      });
      expect(host.textContent).toContain('Width: Enter a value.');
      expect(generateButton(host).disabled).toBe(true);
      await act(async () => {
        generateButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renders core validation issues live (outer walls eat the interior)', async () => {
    const { host, root } = await renderDialog();
    try {
      const select = host.querySelector('select[aria-label="Dimensions are"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('mode select missing');
      const height = input(host, 'Height');
      await act(async () => {
        select.value = 'outer';
        Simulate.change(select);
        height.value = '5';
        Simulate.change(height);
      });
      expect(host.textContent).toContain('leaves no interior');
      expect(generateButton(host).disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('hides the relief tool field until CNC corner relief is turned on', async () => {
    const laser = await renderDialog(LASER);
    try {
      expect(laser.host.querySelector('input[aria-label="Relief tool diameter"]')).toBeNull();
      expect(laser.host.querySelector('select[aria-label="Corner relief"]')).toBeNull();
    } finally {
      await act(async () => laser.root.unmount());
    }
    const cnc = await renderDialog(CNC);
    try {
      // Default: corner relief OFF → the select is present but the tool field hides.
      expect(selectEl(cnc.host, 'Corner relief').value).toBe('off');
      expect(cnc.host.querySelector('input[aria-label="Relief tool diameter"]')).toBeNull();
      expect(input(cnc.host, 'Thickness').value).toBe('6');
      expect(input(cnc.host, 'Clearance').value).toBe('0.15');
      // Turn relief on → the tool field appears, prefilled from the active bit.
      await setSelect(cnc.host, 'Corner relief', 'on');
      expect(input(cnc.host, 'Relief tool diameter').value).toBe('3.175');
    } finally {
      await act(async () => cnc.root.unmount());
    }
  });

  it('warns without blocking when the finger is under twice the relief tool', async () => {
    const { host, root } = await renderDialog({
      kind: 'cnc',
      stockThicknessMm: 3,
      toolDiameterMm: 6,
    });
    try {
      // The relief-tool warning only applies with dogbones on.
      await setSelect(host, 'Corner relief', 'on');
      // z-axis cells are 10 mm: larger than 6 but under 12 → warning only.
      expect(host.textContent).toContain('under twice');
      expect(generateButton(host).disabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('persists the draft on Generate and restores it next open', async () => {
    const first = await renderDialog();
    try {
      const width = input(first.host, 'Width');
      await act(async () => {
        width.value = '80';
        Simulate.change(width);
      });
      await act(async () => {
        generateButton(first.host).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    } finally {
      await act(async () => first.root.unmount());
    }
    const second = await renderDialog();
    try {
      expect(input(second.host, 'Width').value).toBe('80');
    } finally {
      await act(async () => second.root.unmount());
    }
  });

  it('closes on Escape without inserting', async () => {
    const { host, root, onCancel, onGenerate } = await renderDialog();
    try {
      const dialog = host.querySelector('[role="dialog"]');
      await act(async () => {
        dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onGenerate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
