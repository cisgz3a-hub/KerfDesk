import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScanOffsetCalibrationDialog } from './ScanOffsetCalibrationDialog';

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
    root.render(<ScanOffsetCalibrationDialog onCancel={onCancel} onGenerate={onGenerate} />);
  });
  return { host, root, onGenerate, onCancel };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ScanOffsetCalibrationDialog', () => {
  it('renders scan-offset controls and generates parsed options', async () => {
    const { host, root, onGenerate } = await renderDialog();
    try {
      expect(host.textContent).toContain('Scan Offset Test');
      const steps = input(host, 'Steps');
      const speedMax = input(host, 'Max speed');
      const swatchWidth = input(host, 'Swatch width');
      await act(async () => {
        steps.value = '4';
        Simulate.change(steps);
        speedMax.value = '4500';
        Simulate.change(speedMax);
        swatchWidth.value = '20';
        Simulate.change(swatchWidth);
      });

      const generate = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Generate'),
      );
      if (!(generate instanceof HTMLButtonElement)) throw new Error('Generate button missing');
      await act(async () => {
        generate.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ steps: 4, speedMax: 4500, swatchWidthMm: 20 }),
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
