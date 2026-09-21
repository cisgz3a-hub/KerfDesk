import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Operation missing');
  return <CncLayerFields layer={layer} />;
}

async function renderFields(): Promise<{ host: HTMLDivElement; root: Root }> {
  const layer = {
    ...createLayer({ id: 'profile', color: '#123456' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      finishAllowanceMm: 0.2,
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
    dirty: false,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ConnectedFields />));
  return { host, root };
}

function finishControls(host: HTMLElement): {
  input: HTMLInputElement;
  details: HTMLDetailsElement;
  summary: HTMLElement;
} {
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Finish allowance for #123456"]',
  );
  const details = input?.closest('details');
  const summary = details?.querySelector('summary');
  if (input === null || details == null || summary == null) {
    throw new Error('Wall finish controls missing');
  }
  return { input, details, summary };
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  resetStore();
  vi.useRealTimers();
});

describe('CNC refinement navigation', () => {
  it('keeps a pending edit mounted when its group is collapsed, with one undoable commit', async () => {
    vi.useFakeTimers();
    const view = await renderFields();
    try {
      const before = useStore.getState().project;
      const { input, details, summary } = finishControls(view.host);
      await act(async () => summary.click());
      expect(details.open).toBe(true);
      expect(useStore.getState().project).toBe(before);
      await changeInput(input, '0.8');
      await act(async () => summary.click());
      expect(details.open).toBe(false);
      expect(finishControls(view.host).input).toBe(input);
      await act(async () => vi.advanceTimersByTimeAsync(350));
      expect(useStore.getState().project.scene.layers[0]?.cnc?.finishAllowanceMm).toBe(0.8);
      expect(useStore.getState().undoStack).toEqual([before]);
      await act(async () => summary.click());
      expect(input.value).toBe('0.8');
      expect(useStore.getState().project.scene.layers[0]?.id).toBe('profile');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('reconciles a closed group after undo and cancels an obsolete pending draft', async () => {
    vi.useFakeTimers();
    const view = await renderFields();
    try {
      const before = useStore.getState().project;
      const { input, summary } = finishControls(view.host);
      await act(async () => summary.click());
      await changeInput(input, '0.5');
      await act(async () => vi.advanceTimersByTimeAsync(350));
      await changeInput(input, '1.2');
      await act(async () => summary.click());
      await act(async () => useStore.getState().undo());
      await act(async () => vi.advanceTimersByTimeAsync(350));
      expect(useStore.getState().project).toEqual(before);
      await act(async () => summary.click());
      expect(input.value).toBe('0.2');
      expect(useStore.getState().undoStack).toEqual([]);
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
