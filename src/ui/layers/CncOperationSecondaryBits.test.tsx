import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
import { useMachineSetupDialogStore } from '../laser/device-setup/machine-setup-dialog-store';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncLayerFields } from './CncLayerFields';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

beforeEach(async () => {
  resetStore();
  const layer = {
    ...createLayer({ id: 'chosen', color: '#123456' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      toolId: 'em-1588',
      pocketRoughToolId: 'em-6350',
      vClearToolId: 'em-3175',
      feedMmPerMin: 731,
    },
  };
  useStore.setState({
    project: {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { layers: [layer], objects: [] },
    },
    undoStack: [],
    redoStack: [],
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<ConnectedFields />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
  vi.useRealTimers();
});

// ADR-431: the second bit a cut type can use sits under Bit, only while that
// cut type uses it; the bit library itself lives in Machine Setup.
describe('CNC operation bits', () => {
  it('names the job default and shows only the second bit this cut type uses', () => {
    const primary = required<HTMLSelectElement>('select[aria-label="Bit for #123456"]');
    const jobDefault = DEFAULT_CNC_MACHINE_CONFIG.tools.find(
      (tool) => tool.id === DEFAULT_CNC_MACHINE_CONFIG.toolId,
    );
    const chosen = DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.id === 'em-1588');
    expect(primary.value).toBe('em-1588');
    expect(primary.querySelector('option[value=""]')?.textContent).toBe(
      `Job default: ${jobDefault?.name}`,
    );
    expect(primary.title).toContain(`Current: ${chosen?.name}.`);
    const roughing = required<HTMLSelectElement>(
      'select[aria-label="Pocket roughing bit for #123456"]',
    );
    expect(roughing.value).toBe('em-6350');
    expect(roughing.closest('details')).toBeNull();
    expect(host.querySelector('select[aria-label="Clearing bit for #123456"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Relief finishing bit for #123456"]')).toBeNull();
    expect(host.querySelector('.lf-cnc-tool-details')).toBeNull();
    expect(host.textContent).not.toContain('Add another bit');
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('keeps a pending feed edit while a second bit is chosen', async () => {
    vi.useFakeTimers();
    const before = useStore.getState().project;
    const feed = required<HTMLInputElement>('input[aria-label="Feed for #123456"]');
    const roughing = required<HTMLSelectElement>(
      'select[aria-label="Pocket roughing bit for #123456"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(feed, '1800');
      feed.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(required('input[aria-label="Feed for #123456"]')).toBe(feed);
    expect(roughing.value).toBe('em-6350');
    expect(useStore.getState().project).toBe(before);
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(1800);
    expect(useStore.getState().undoStack).toEqual([before]);
    await act(async () => useStore.getState().undo());
    expect(feed.value).toBe('731');
    expect(roughing.value).toBe('em-6350');
  });

  it('swaps the second bit with the cut type without deleting dormant bindings', async () => {
    const cutType = required<HTMLSelectElement>('select[aria-label="Cut type for #123456"]');
    await act(async () => {
      cutType.value = 'v-carve';
      cutType.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('select[aria-label="Pocket roughing bit for #123456"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Clearing bit for #123456"]')).toBeNull();
    await act(async () =>
      required<HTMLInputElement>('input[aria-label="Flat depth for #123456"]').click(),
    );
    expect(required<HTMLSelectElement>('select[aria-label="Clearing bit for #123456"]').value).toBe(
      'em-3175',
    );
    expect(useStore.getState().project.scene.layers[0]?.cnc).toMatchObject({
      pocketRoughToolId: 'em-6350',
      vClearToolId: 'em-3175',
    });
  });

  it('opens the Machine Setup bit library from Manage bits', async () => {
    const manage = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Manage bits',
    );
    if (manage === undefined) throw new Error('Manage bits missing');
    await act(async () => manage.click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { kind: 'cnc', field: 'bit-library' },
    });
    useMachineSetupDialogStore.getState().close();
  });
});

function required<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}
