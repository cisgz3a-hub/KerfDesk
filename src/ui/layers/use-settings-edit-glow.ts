// Editing settings lights up the artwork they change (ADR-646). While focus is
// anywhere inside a settings editor (a number field, a slider, a process
// button), the canvas keeps the hover pulse's soft colour edge on exactly the
// pieces an edit there changes, and pulses them as each change lands. Display
// only: nothing is selected or changed.

import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../state/ui-store';

/** The artwork an edit changes, and the operations whose colour it lights up in. */
export type EditReach = {
  readonly objectIds: ReadonlyArray<string>;
  readonly operationIds: ReadonlyArray<string>;
};

/**
 * A control whose edit reaches other artwork than the rest of its editor is
 * marked `data-edit-scope` (ADR-646 Amendment 1): "operation" (every piece of
 * the operation), "selection" (the selected pieces) or "everything" (all
 * artwork, in every operation).
 */
export type EditScope = 'operation' | 'selection' | 'everything';

export type SettingsEditGlowTarget = EditReach & {
  /** Unique per editor, so one editor losing focus never clears another's glow. */
  readonly owner: string;
  /** The reach of controls marked with a scope; unmarked controls use the editor's own. */
  readonly scopes?: Partial<Record<EditScope, EditReach>>;
};

export function useSettingsEditGlow(target: SettingsEditGlowTarget): {
  readonly onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: React.FocusEvent<HTMLElement>) => void;
} {
  const setEdited = useUiStore((state) => state.setEditedArtwork);
  const release = useUiStore((state) => state.releaseEditedArtwork);
  const [editor, setEditor] = useState<HTMLElement | null>(null);
  const [scope, setScope] = useState<EditScope | null>(null);
  const { owner } = target;
  const reach = (scope === null ? undefined : target.scopes?.[scope]) ?? target;
  const objectKey = JSON.stringify(reach.objectIds);
  const operationKey = JSON.stringify(reach.operationIds);
  const latest = useRef(reach);
  latest.current = reach;
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
    const end = (): void => {
      // Released now, not after the next render: what ended the edit may
      // change the scene (another row's eye, a drag), which must not pulse it.
      release(owner);
      setEditor(null);
    };
    // A focused control that re-renders away takes focus with it and sends
    // no blur, so a press anywhere outside the editor also ends the edit.
    // With focus still inside, the press blurs it next, and a field that
    // commits on blur must land as this edit's last change: that blur ends
    // the edit after the commit, still before the pressed control acts on
    // click. Should no blur come, the edit ends right after the press.
    let pressEnd: ReturnType<typeof setTimeout> | null = null;
    const pressOutside = (event: Event): void => {
      if (event.target instanceof Node && editor.contains(event.target)) return;
      if (!editor.contains(document.activeElement)) end();
      else if (pressEnd === null) pressEnd = setTimeout(end, 0);
    };
    // Focus falling back to the page once a click or key has removed the
    // focused control (Remove Focus Test Z, say) ends the edit too.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const afterAction = (): void => {
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        if (!editor.contains(document.activeElement)) end();
      }, 0);
    };
    const listeners = [
      ['pointerdown', pressOutside],
      ['click', afterAction],
      ['keyup', afterAction],
    ] as const;
    for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
    return () => {
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
      if (pending !== null) clearTimeout(pending);
      if (pressEnd !== null) clearTimeout(pressEnd);
    };
  }, [editor, owner, release]);
  // After the render that ends the edit, so a value a field commits on its
  // blur reaches the canvas while the edit still holds, and pulses.
  useEffect(() => {
    if (editor === null) release(owner);
  }, [editor, owner, release]);
  // An editor removed while focused (selection cleared, tab switched) sends no blur.
  useEffect(() => () => release(owner), [owner, release]);
  return {
    onFocus: (event) => {
      setScope(editScopeOf(event.target));
      setEditor(event.currentTarget);
    },
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setEditor(null);
    },
  };
}

function editScopeOf(target: EventTarget): EditScope | null {
  if (!(target instanceof Element)) return null;
  const scope = target.closest('[data-edit-scope]')?.getAttribute('data-edit-scope');
  return scope === 'operation' || scope === 'selection' || scope === 'everything' ? scope : null;
}
