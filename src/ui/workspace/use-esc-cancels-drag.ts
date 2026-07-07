// Esc-cancels-an-in-progress-drag hook (audit C4), split out of
// use-workspace-drag.ts to keep that module under the file-size cap. Registers
// a CAPTURE-phase keydown listener so stopPropagation pre-empts the
// bubble-phase global shortcut handler — Esc during a drag cancels ONLY the
// drag; it must not also reset the tool and clear the selection. Mounted only
// while a cancelable drag is live, so plain Esc (no drag) is untouched.

import { useEffect } from 'react';
import type { DragState } from './drag-state';
import type { useWorkspaceDragDeps } from './workspace-drag-deps';

// Transforms roll back via cancelInteraction; a marquee just clears its box.
// Draw/measure/pen/pan keep the existing global Esc (resetToolMode) behavior.
const ESC_CANCELABLE_DRAG_KINDS: ReadonlySet<DragState['kind']> = new Set([
  'move',
  'scale',
  'selection-scale',
  'rotate',
  'path-node',
  'marquee',
]);

export function useEscCancelsDrag(
  drag: DragState | null,
  deps: ReturnType<typeof useWorkspaceDragDeps>,
  setDrag: (next: DragState | null) => void,
): void {
  const { cancelInteraction, setSelectionMarquee, setMeasureDraft, setDraftShape, setSnapGuides } =
    deps;
  const active = drag !== null && ESC_CANCELABLE_DRAG_KINDS.has(drag.kind);
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelInteraction();
      setSelectionMarquee(null);
      setMeasureDraft(null);
      setDraftShape(null);
      setSnapGuides([]);
      setDrag(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    active,
    cancelInteraction,
    setSelectionMarquee,
    setMeasureDraft,
    setDraftShape,
    setSnapGuides,
    setDrag,
  ]);
}
