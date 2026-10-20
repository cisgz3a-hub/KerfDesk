// Editing settings lights up the artwork they change (ADR-645). While focus is
// anywhere inside a settings editor (a number field, a slider, a process
// button), the canvas keeps the hover pulse's soft colour edge on exactly the
// pieces an edit there changes, and pulses them as each change lands. Display
// only: nothing is selected or changed.

import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../state/ui-store';

export type SettingsEditGlowTarget = {
  /** Unique per editor, so one editor losing focus never clears another's glow. */
  readonly owner: string;
  readonly objectIds: ReadonlyArray<string>;
  readonly operationIds: ReadonlyArray<string>;
};

export function useSettingsEditGlow(target: SettingsEditGlowTarget): {
  readonly onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: React.FocusEvent<HTMLElement>) => void;
} {
  const setEdited = useUiStore((state) => state.setEditedArtwork);
  const release = useUiStore((state) => state.releaseEditedArtwork);
  const [editor, setEditor] = useState<HTMLElement | null>(null);
  const { owner } = target;
  const objectKey = JSON.stringify(target.objectIds);
  const operationKey = JSON.stringify(target.operationIds);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (editor === null) return;
    setEdited({
      owner,
      objectIds: latest.current.objectIds,
      operationIds: latest.current.operationIds,
    });
  }, [editor, owner, objectKey, operationKey, setEdited]);
  useEffect(() => {
    if (editor === null) return;
    // A focused control that re-renders away takes focus with it and sends
    // no blur, so a press anywhere outside the editor also ends the edit.
    const pressOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !editor.contains(event.target)) setEditor(null);
    };
    document.addEventListener('pointerdown', pressOutside, true);
    return () => document.removeEventListener('pointerdown', pressOutside, true);
  }, [editor]);
  useEffect(() => {
    if (editor === null) release(owner);
  }, [editor, owner, release]);
  // An editor removed while focused (selection cleared, tab switched) sends no blur.
  useEffect(() => () => release(owner), [owner, release]);
  return {
    onFocus: (event) => setEditor(event.currentTarget),
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setEditor(null);
    },
  };
}
