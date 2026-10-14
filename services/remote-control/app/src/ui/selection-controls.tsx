import { useEffect } from 'react';
import { controller } from '../core/controller';
import { selectableIds } from '../core/scene';
import { canEdit, selectionComplete, store } from '../core/store';
import { cancelCanvasGesture, typingTarget } from './canvas-gesture-types';
import { useApp } from './hooks';
import { Icon } from './icons';

export function SelectionControls() {
  const mode = useApp((state) => state.selectionMode);
  const selection = useApp((state) => state.selection);
  const workspace = useApp((state) => state.workspace);
  return (
    <div className="selection-controls">
      <div role="toolbar" aria-label="Selection controls">
        <button
          type="button"
          aria-pressed={mode === 'toggle'}
          onClick={() =>
            store.set({
              tool: 'select',
              draft: null,
              selectionMode: mode === 'toggle' ? 'replace' : 'toggle',
            })
          }
        >
          <Icon name="group" size={18} /> Multi-select
        </button>
        <button
          type="button"
          disabled={workspace === null || workspace.totalArtwork === 0}
          onClick={() => {
            cancelCanvasGesture();
            void controller.selectAll();
          }}
        >
          <Icon name="select" size={18} /> Select all
        </button>
        <button
          type="button"
          disabled={selection.length === 0}
          onClick={() => {
            cancelCanvasGesture();
            void controller.select([]);
          }}
        >
          <Icon name="close" size={18} /> Deselect
        </button>
      </div>
      <p className="selection-help">
        {mode === 'toggle' ? 'Tap items to add or remove. ' : 'Shift-click adds or removes. '}
        <span>Drag right to enclose; left to cross.</span>
      </p>
    </div>
  );
}

export function useDesignKeyboard(): void {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;
      const state = store.get();
      if (state.sheet !== null) return;
      const { selection, draft } = state;
      if (event.key === 'Escape') {
        if (cancelCanvasGesture()) event.preventDefault();
        else if (draft !== null) {
          event.preventDefault();
          store.set({ draft: null, preview: null });
        } else if (selection.length > 0) {
          event.preventDefault();
          void controller.select([]);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        cancelCanvasGesture();
        void controller.selectAll();
        return;
      }
      if (!canEdit(state)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        cancelCanvasGesture();
        void controller.write(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      const allowed = new Set(selectableIds(state.workspace?.artwork ?? [], state.scene));
      if (
        selection.length === 0 ||
        !selectionComplete(state) ||
        !selection.every((id) => allowed.has(id))
      )
        return;
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        if (state.pending === 0) void controller.move(selection, move[0], move[1]);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (state.pending === 0)
          void controller.write('arrange_artwork', { artworkIds: selection, action: 'delete' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}
