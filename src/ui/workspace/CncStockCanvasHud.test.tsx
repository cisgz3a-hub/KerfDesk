import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { closeMachineSetup } from '../laser/device-setup';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
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
  closeMachineSetup();
  resetStore();
});

function buttonByName(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${name} button missing`);
  return button;
}

async function expandHud(container: HTMLElement): Promise<HTMLButtonElement> {
  const expand = container.querySelector(
    'button[aria-label="Expand stock reference from Startup Setup"]',
  );
  if (!(expand instanceof HTMLButtonElement)) throw new Error('expand button missing');
  await act(async () => expand.click());
  return expand;
}

describe('CncStockCanvasHud', () => {
  it('stays off the laser canvas and starts folded with the current CNC stock summary', async () => {
    const laserHost = await renderHud('laser');
    expect(laserHost.querySelector('[aria-label="Stock from Startup Setup"]')).toBeNull();

    await act(async () => root?.unmount());
    laserHost.remove();
    root = null;
    host = null;

    const cncHost = await renderHud('cnc');
    expect(cncHost.textContent).toContain('400 x 400 x 6.35 mm');
    expect(cncHost.querySelector('input')).toBeNull();
    expect(
      cncHost.querySelector('button[aria-label="Expand stock reference from Startup Setup"]'),
    ).not.toBeNull();
  });

  it('expands into read-only facts and collapses back to the compact state', async () => {
    const container = await renderHud('cnc');
    const panel = container.querySelector('[aria-label="Stock from Startup Setup"]');
    if (!(panel instanceof HTMLElement)) throw new Error('stock reference missing');
    expect(panel.style.width).toBe('176px');

    const toggle = await expandHud(container);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Read-only here');
    expect(container.textContent).toContain('X 0, Y 0 mm');
    expect(container.querySelector('input')).toBeNull();

    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the exact Startup Setup stock editor without changing the project', async () => {
    const container = await renderHud('cnc');
    const projectBefore = useStore.getState().project;
    await expandHud(container);

    await act(async () => buttonByName(container, 'Edit in Startup Setup').click());

    expect(useStore.getState().project).toBe(projectBefore);
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'cnc', field: 'stock' },
    });
  });
});
