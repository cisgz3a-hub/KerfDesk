import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { loadTrace } from './trace-part-test-fixtures';
import { TracePartsHint } from './TracePartsHint';
import { setTracePartPreparationStatus } from './trace-part-preparation-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useUiStore.getState().resetToolMode();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('path editing completion', () => {
  it.each([
    { kind: 'node', label: 'nodes' },
    { kind: 'trace-parts', label: 'trace parts' },
  ] as const)('finishes $label while keeping completed changes available to Undo', async (mode) => {
    loadTrace(IDENTITY_TRANSFORM, 1);
    useStore.getState().selectObject('trace');
    const original = useStore.getState().project;
    useStore.getState().beginInteraction();
    useStore.getState().setObjectTransform('trace', { ...IDENTITY_TRANSFORM, x: 12 });
    useStore.getState().endInteraction();
    const edited = useStore.getState().project;
    const history = useStore.getState().undoStack;
    useUiStore.getState().setToolMode({ kind: mode.kind });
    await act(async () => root.render(<TracePartsHint />));
    const done = host.querySelector<HTMLButtonElement>(
      `button[aria-label="Done editing ${mode.label}"]`,
    );
    expect(done?.textContent).toBe('Done');
    expect(host.textContent).toContain('Esc cancels a drag');

    await act(async () => done?.click());

    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useStore.getState().project).toBe(edited);
    expect(useStore.getState().undoStack).toBe(history);
    expect(useStore.getState().selectedObjectId).toBe('trace');
    expect(host.textContent).toBe('');
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(original);
  });

  it('keeps Done available in node mode with no current selection', async () => {
    useUiStore.getState().setToolMode({ kind: 'node' });
    await act(async () => root.render(<TracePartsHint />));
    const done = host.querySelector<HTMLButtonElement>('button[aria-label="Done editing nodes"]');

    expect(done).not.toBeNull();
    await act(async () => done?.click());

    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(host.textContent).toBe('');
  });

  it('shares one panel for primitive conversion and Done, keeping conversion undoable', async () => {
    const primitive = createRectangle({
      id: 'rectangle',
      color: '#000000',
      spec: { widthMm: 40, heightMm: 80, cornerRadiusMm: 0 },
    });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [primitive],
          layers: [createLayer({ id: '#000000', color: '#000000' })],
        },
      },
      selectedObjectId: primitive.id,
    }));
    useUiStore.getState().setToolMode({ kind: 'node' });
    await act(async () => root.render(<TracePartsHint />));
    const hint = host.querySelector('[role="status"]');
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(hint?.textContent).toContain('Convert the rectangle to a path');
    expect(hint?.textContent).not.toContain('Drag nodes or curve handles');
    const convert = [...(hint?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Convert to Path',
    );
    const done = hint?.querySelector<HTMLButtonElement>('button[aria-label="Done editing nodes"]');
    expect(done).not.toBeNull();
    expect(convert).toBeDefined();

    await act(async () => convert?.click());
    expect(useStore.getState().project.scene.objects[0]?.kind).toBe('imported-svg');
    expect(hint?.textContent).toContain('Drag nodes or curve handles');
    await act(async () => done?.click());
    expect(useUiStore.getState().toolMode.kind).toBe('select');
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.scene.objects[0]).toBe(primitive);
  });

  it('keeps Done available during trace preparation and offers Retry after failure', async () => {
    loadTrace(IDENTITY_TRANSFORM, 1);
    useUiStore.getState().setToolMode({ kind: 'trace-parts' });
    await act(async () => root.render(<TracePartsHint />));
    const hint = host.querySelector('[role="status"]');
    const done = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Done editing trace parts"]',
    );

    await act(async () => setTracePartPreparationStatus('preparing'));
    expect(hint?.getAttribute('aria-busy')).toBe('true');
    expect(host.textContent).toContain('Preparing trace parts');
    expect(done?.disabled).toBe(false);

    await act(async () => setTracePartPreparationStatus('error', 'Could not prepare trace parts.'));
    expect(hint?.getAttribute('aria-busy')).toBe('false');
    const retry = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(host.textContent).toContain('Drag a traced line or shape');
    expect(host.textContent).not.toContain('Retry');

    await act(async () => setTracePartPreparationStatus('preparing'));
    await act(async () => done?.click());
    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
