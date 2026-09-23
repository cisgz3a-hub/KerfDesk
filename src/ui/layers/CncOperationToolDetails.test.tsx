import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
} from '../../core/scene';
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

describe('compact CNC tool details', () => {
  it('identifies the real job default and active secondary tools while details are closed', () => {
    const primary = required<HTMLSelectElement>('select[aria-label="Bit for #123456"]');
    const jobDefault = DEFAULT_CNC_MACHINE_CONFIG.tools.find(
      (tool) => tool.id === DEFAULT_CNC_MACHINE_CONFIG.toolId,
    );
    expect(primary.value).toBe('em-1588');
    expect(primary.querySelector('option[value=""]')?.textContent).toBe(
      `Job default: ${jobDefault?.name}`,
    );
    const details = required<HTMLDetailsElement>('.lf-cnc-tool-details');
    const summary = details.querySelector('summary');
    expect(details.open).toBe(false);
    expect(summary?.textContent).toContain('Roughing:');
    expect(summary?.textContent).toContain(
      DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.id === 'em-6350')?.name,
    );
    expect(summary?.textContent).not.toContain('Floor:');
    expect(summary?.textContent).not.toContain('Finish:');
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('keeps a pending feed edit and secondary binding intact when tool details are folded', async () => {
    vi.useFakeTimers();
    const before = useStore.getState().project;
    const details = required<HTMLDetailsElement>('.lf-cnc-tool-details');
    const summary = required<HTMLElement>('.lf-cnc-tool-details > summary');
    const feed = required<HTMLInputElement>('input[aria-label="Feed for #123456"]');
    const secondary = required<HTMLSelectElement>(
      'select[aria-label="Pocket roughing bit for #123456"]',
    );
    await act(async () => summary.click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(feed, '1800');
      feed.dispatchEvent(new Event('input', { bubbles: true }));
      summary.click();
    });
    expect(details.open).toBe(false);
    expect(required('select[aria-label="Pocket roughing bit for #123456"]')).toBe(secondary);
    expect(required('input[aria-label="Feed for #123456"]')).toBe(feed);
    expect(secondary.value).toBe('em-6350');
    expect(useStore.getState().project).toBe(before);
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(useStore.getState().project.scene.layers[0]?.cnc?.feedMmPerMin).toBe(1800);
    expect(useStore.getState().undoStack).toEqual([before]);
    await act(async () => useStore.getState().undo());
    await act(async () => summary.click());
    expect(feed.value).toBe('731');
    expect(secondary.value).toBe('em-6350');
  });

  it('updates the collapsed tool summary without deleting dormant operation bindings', async () => {
    const cutType = required<HTMLSelectElement>('select[aria-label="Cut type for #123456"]');
    await act(async () => {
      cutType.value = 'v-carve';
      cutType.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const summary = required<HTMLElement>('.lf-cnc-tool-details > summary');
    expect(summary.textContent).not.toContain('Roughing:');
    expect(summary.textContent).not.toContain('Floor:');
    await act(async () =>
      required<HTMLInputElement>('input[aria-label="Flat depth for #123456"]').click(),
    );
    expect(summary.textContent).toContain('Floor:');
    expect(summary.textContent).toContain(
      DEFAULT_CNC_MACHINE_CONFIG.tools.find((tool) => tool.id === 'em-3175')?.name,
    );
    expect(useStore.getState().project.scene.layers[0]?.cnc).toMatchObject({
      pocketRoughToolId: 'em-6350',
      vClearToolId: 'em-3175',
    });
  });
});

function required<T extends HTMLElement>(selector: string): T {
  const element = host.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing ${selector}`);
  return element;
}
