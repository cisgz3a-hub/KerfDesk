import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncStockCanvasHud } from './CncStockCanvasHud';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHud(machineKind: 'laser' | 'cnc'): Promise<HTMLDivElement> {
  if (machineKind === 'cnc') useStore.getState().setMachineKind('cnc');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<CncStockCanvasHud />));
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  resetStore();
});

function inputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${label} input missing`);
  return input;
}

async function expandHud(container: HTMLElement): Promise<HTMLButtonElement> {
  const expand = container.querySelector('button[aria-label="Expand Stock controls"]');
  if (!(expand instanceof HTMLButtonElement)) throw new Error('expand button missing');
  await act(async () => expand.click());
  return expand;
}

async function editAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus();
    setInputValue(input, value);
    input.blur();
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CncStockCanvasHud', () => {
  it('stays off the laser canvas and starts folded with the current CNC stock summary', async () => {
    const laserHost = await renderHud('laser');
    expect(laserHost.querySelector('[aria-label="Stock controls"]')).toBeNull();

    await act(async () => root?.unmount());
    laserHost.remove();
    root = null;
    host = null;

    const cncHost = await renderHud('cnc');
    expect(cncHost.textContent).toContain('400 × 400 × 6.35 mm');
    expect(cncHost.querySelector('input')).toBeNull();
    const expand = cncHost.querySelector('button[aria-label="Expand Stock controls"]');
    expect(expand?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands the folded summary and collapses back to the compact state', async () => {
    const container = await renderHud('cnc');
    const panel = container.querySelector('[aria-label="Stock controls"]');
    if (!(panel instanceof HTMLElement)) throw new Error('stock panel missing');
    expect(panel.style.width).toBe('176px');
    expect(panel.style.background).toBe('color-mix(in srgb, var(--lf-bg-1) 68%, transparent)');
    expect(panel.style.backdropFilter).toBe('blur(6px)');
    expect(container.textContent).toContain('400 × 400 × 6.35 mm');
    expect(container.querySelector('input')).toBeNull();

    const toggle = await expandHud(container);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(inputByLabel(container, 'Stock height').value).toBe('400');

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('input')).toBeNull();
  });

  it('commits canvas edits through the existing clamped CNC stock action', async () => {
    const container = await renderHud('cnc');
    await expandHud(container);
    await editAndBlur(inputByLabel(container, 'Stock width'), '520');
    await editAndBlur(inputByLabel(container, 'Stock thickness'), '250');
    await editAndBlur(inputByLabel(container, 'Stock origin X'), '-25');

    const machine = useStore.getState().project.machine;
    expect(machine?.kind).toBe('cnc');
    if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
    expect(machine.stock.widthMm).toBe(520);
    expect(machine.stock.thicknessMm).toBe(200);
    expect(machine.stock.originOffset).toEqual({ x: -25, y: 0 });
    expect(container.textContent).toContain('520 × 400 × 200 mm');
  });

  it('preserves both origin coordinates when their debounced edits commit together', async () => {
    vi.useFakeTimers();
    try {
      const container = await renderHud('cnc');
      await expandHud(container);
      const originX = inputByLabel(container, 'Stock origin X');
      const originY = inputByLabel(container, 'Stock origin Y');

      await act(async () => {
        setInputValue(originX, '125');
        setInputValue(originY, '250');
      });
      await act(async () => vi.advanceTimersByTime(300));

      const machine = useStore.getState().project.machine;
      if (machine?.kind !== 'cnc') throw new Error('CNC machine missing');
      expect(machine.stock.originOffset).toEqual({ x: 125, y: 250 });
    } finally {
      vi.useRealTimers();
    }
  });
});
