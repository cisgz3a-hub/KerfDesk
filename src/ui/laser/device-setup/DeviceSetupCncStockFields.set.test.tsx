// ADR-258 Amendment 6 (J1-P3-3): Machine Setup can mark a real 6.35 mm sheet
// as set. The field already shows 6.35 and re-entering it commits nothing, so
// an unset thickness offers "Use 6.35 mm"; any committed thickness is set too.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_STOCK,
  type CncMachineConfig,
  type CncStock,
} from '../../../core/scene';
import { DeviceSetupCncStockFields } from './DeviceSetupCncStockFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function render(stock: CncStock, onChange: (stock: CncStock) => void): HTMLDivElement {
  const machine: CncMachineConfig = { ...DEFAULT_CNC_MACHINE_CONFIG, stock };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<DeviceSetupCncStockFields machine={machine} onChange={onChange} />));
  return host;
}

function useButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.startsWith('Use '),
  );
}

describe('Machine Setup marks the stock thickness set (ADR-258 Amendment 6)', () => {
  it('offers Use 6.35 mm while the default is unset, and marks the stock set', () => {
    const onChange = vi.fn<(stock: CncStock) => void>();
    const container = render(DEFAULT_CNC_STOCK, onChange);
    const button = useButton(container);
    expect(button?.textContent).toBe('Use 6.35 mm');
    expect(container.textContent).toContain('holding tabs are measured from the cut floor');

    act(() => Simulate.click(button as HTMLButtonElement));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CNC_STOCK, thicknessSet: true });
  });

  it('offers nothing once the thickness is set, by the mark or by another value', () => {
    expect(useButton(render({ ...DEFAULT_CNC_STOCK, thicknessSet: true }, vi.fn()))).toBe(
      undefined,
    );
    act(() => root?.unmount());
    expect(useButton(render({ ...DEFAULT_CNC_STOCK, thicknessMm: 12 }, vi.fn()))).toBe(undefined);
  });

  it('marks a typed thickness as set', () => {
    const onChange = vi.fn<(stock: CncStock) => void>();
    const container = render(DEFAULT_CNC_STOCK, onChange);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Stock thickness"]');
    if (input === null) throw new Error('expected the Stock thickness field');
    // Separate acts, as a typed value and leaving the field arrive: blur reads
    // the draft React stored from the change.
    act(() => {
      input.value = '12';
      Simulate.change(input);
    });
    act(() => Simulate.blur(input));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CNC_STOCK,
      thicknessMm: 12,
      thicknessSet: true,
    });
  });
});
