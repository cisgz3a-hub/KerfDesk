import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
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

async function editAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native input value setter missing');
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}

describe('CncStockCanvasHud', () => {
  it('stays off the laser canvas and opens with the current CNC stock summary', async () => {
    const laserHost = await renderHud('laser');
    expect(laserHost.querySelector('[aria-label="Stock controls"]')).toBeNull();

    await act(async () => root?.unmount());
    laserHost.remove();
    root = null;
    host = null;

    const cncHost = await renderHud('cnc');
    expect(cncHost.textContent).toContain('400 × 400 × 6.35 mm');
    expect(inputByLabel(cncHost, 'Stock thickness').value).toBe('6.35');
    expect(inputByLabel(cncHost, 'Stock width').value).toBe('400');
    expect(inputByLabel(cncHost, 'Stock origin X').value).toBe('0');
  });

  it('collapses to the summary and restores the editable fields', async () => {
    const container = await renderHud('cnc');
    const panel = container.querySelector('[aria-label="Stock controls"]');
    if (!(panel instanceof HTMLElement)) throw new Error('stock panel missing');
    const collapse = container.querySelector('button[aria-label="Collapse Stock controls"]');
    if (!(collapse instanceof HTMLButtonElement)) throw new Error('collapse button missing');

    await act(async () => collapse.click());
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(panel.style.width).toBe('176px');
    expect(panel.style.background).toBe('color-mix(in srgb, var(--lf-bg-1) 68%, transparent)');
    expect(panel.style.backdropFilter).toBe('blur(6px)');
    expect(container.textContent).toContain('400 × 400 × 6.35 mm');
    expect(container.querySelector('input')).toBeNull();

    await act(async () => collapse.click());
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(inputByLabel(container, 'Stock height').value).toBe('400');
  });

  it('commits canvas edits through the existing clamped CNC stock action', async () => {
    const container = await renderHud('cnc');
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
});
