import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useShortcuts } from '../app/use-shortcuts';
import { closeMachineSetup } from '../laser/device-setup';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { CncStockCanvasHud } from './CncStockCanvasHud';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function ShortcutHarness(): null {
  useShortcuts();
  return null;
}

function loadCncJob(thicknessMm: number): void {
  const device = { ...useStore.getState().project.device, capabilities: ['cnc-output'] as const };
  useStore.getState().setProject({
    ...createProject(device),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm },
    },
  });
  useStore.getState().markLoaded('job.lf2');
}

function stockThickness(): number {
  const machine = useStore.getState().project.machine;
  if (machine?.kind !== 'cnc') throw new Error('expected CNC machine');
  return machine.stock.thicknessMm;
}

async function mountExpanded(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <PlatformProvider adapter={platform}>
        <ShortcutHarness />
        <CncStockCanvasHud />
      </PlatformProvider>,
    );
  });
  const expand = host.querySelector(
    'button[aria-label="Expand stock reference from Machine Setup"]',
  );
  if (!(expand instanceof HTMLButtonElement)) throw new Error('stock expansion missing');
  await act(async () => expand.click());
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).toContain('Read-only here');
}

function displayedThickness(thickness: number): void {
  expect(host?.querySelector('dd')?.textContent).toContain(' x ' + thickness + ' mm');
  expect(host?.querySelector('input')).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  closeMachineSetup();
  useConfirmSaveStore.getState().choose('cancel');
  useLaserStore.setState({ streamer: null });
  useUiStore.setState({ modalDepth: 0, textDialog: null, imageDialog: null });
  loadCncJob(20);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
  closeMachineSetup();
  useConfirmSaveStore.getState().choose('cancel');
  resetStore();
});

describe('CNC stock reference follows its current project document', () => {
  it('shows fresh stock when Ctrl+N starts a new job from the expanded stock reference', async () => {
    await mountExpanded();
    displayedThickness(20);
    const oldEpoch = useStore.getState().projectDocumentEpoch;
    await act(async () => {
      host?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'n',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useStore.getState().projectDocumentEpoch).toBe(oldEpoch + 1);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    const defaultThickness = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    displayedThickness(defaultThickness);
    await act(async () => vi.advanceTimersByTime(300));
    expect(stockThickness()).toBe(defaultThickness);
    expect(useStore.getState().dirty).toBe(false);
  });

  it.each([20, 33])(
    'shows the opened document stock thickness %s without changing it',
    async (nextThickness) => {
      await mountExpanded();
      const oldEpoch = useStore.getState().projectDocumentEpoch;
      await act(async () => loadCncJob(nextThickness));
      expect(useStore.getState().projectDocumentEpoch).toBe(oldEpoch + 1);
      displayedThickness(nextThickness);
      await act(async () => vi.advanceTimersByTime(300));
      expect(stockThickness()).toBe(nextThickness);
      expect(useStore.getState().dirty).toBe(false);
    },
  );
});
