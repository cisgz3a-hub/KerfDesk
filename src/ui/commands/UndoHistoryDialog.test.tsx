import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createProject, type Project } from '../../core/scene';
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
});

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}
