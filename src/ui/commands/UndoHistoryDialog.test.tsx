import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { UndoHistoryDialog } from './UndoHistoryDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(
  props: {
    readonly current?: Project;
    readonly undoStack?: ReadonlyArray<Project>;
    readonly redoStack?: ReadonlyArray<Project>;
    readonly onUndo?: () => void;
    readonly onRedo?: () => void;
    readonly onUndoSteps?: (count: number) => void;
    readonly onRedoSteps?: (count: number) => void;
    readonly onClose?: () => void;
  } = {},
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <UndoHistoryDialog
        current={props.current ?? createProject()}
        undoStack={props.undoStack ?? []}
        redoStack={props.redoStack ?? []}
        onUndo={props.onUndo ?? vi.fn()}
        onRedo={props.onRedo ?? vi.fn()}
        onUndoSteps={props.onUndoSteps ?? vi.fn()}
        onRedoSteps={props.onRedoSteps ?? vi.fn()}
        onClose={props.onClose ?? vi.fn()}
      />,
    );
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('UndoHistoryDialog', () => {
  it('shows current, undo, and redo history summaries', async () => {
    const { host, root } = await renderDialog({
      undoStack: [createProject(), createProject()],
      redoStack: [createProject()],
    });
    try {
      expect(host.textContent).toContain('Current project');
      expect(host.textContent).toContain('Undo history');
      expect(host.textContent).toContain('2 available');
      expect(host.textContent).toContain('Redo history');
      expect(host.textContent).toContain('1 available');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('runs undo and redo actions from the dialog', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { host, root } = await renderDialog({
      undoStack: [createProject()],
      redoStack: [createProject()],
      onUndo,
      onRedo,
    });
    try {
      await act(async () => {
        button(host, 'Undo').click();
        button(host, 'Redo').click();
      });
      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(onRedo).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('names every step as one newest-first timeline and jumps to the clicked one', async () => {
    // Timeline: empty → add a → add b → (current) … redo: add c → add d.
    const empty = createProject();
    const withA = withObjects(empty, ['a']);
    const withAB = withObjects(empty, ['a', 'b']);
    const withABC = withObjects(empty, ['a', 'b', 'c']);
    const withABCD = withObjects(empty, ['a', 'b', 'c', 'd']);
    const onUndoSteps = vi.fn();
    const onRedoSteps = vi.fn();
    const { host, root } = await renderDialog({
      current: withAB,
      undoStack: [empty, withA],
      redoStack: [withABCD, withABC],
      onUndoSteps,
      onRedoSteps,
    });
    try {
      const rows = [...host.querySelectorAll<HTMLButtonElement>('[data-history-direction]')];
      expect(rows.map((row) => row.dataset['historyDirection'])).toEqual([
        'redo',
        'redo',
        'undo',
        'undo',
      ]);
      expect(rows.map((row) => row.textContent)).toEqual([
        'Add rectangle2 steps forward',
        'Add rectangle1 step forward',
        'Add rectangle1 step back',
        'Add rectangle2 steps back',
      ]);
      for (const row of rows) expect(row.title).not.toBe('');
      await act(async () => {
        rows[3]?.click();
        rows[0]?.click();
      });
      expect(onUndoSteps).toHaveBeenCalledWith(2);
      expect(onRedoSteps).toHaveBeenCalledWith(2);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function withObjects(base: Project, ids: ReadonlyArray<string>): Project {
  const objects = ids.map((id) =>
    createRectangle({ id, color: '#000000', spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 } }),
  );
  return { ...base, scene: { ...base.scene, objects } };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}
