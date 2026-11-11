// Hold Alt (Option on a Mac) to see every operation colour on the canvas, and
// let go to return to plain ink (ADR-620). The peek waits a moment and is
// cancelled by another key or pointer gesture, so shortcuts such as Alt+Left
// never flash the colours on the way through. Nor does holding Alt while
// typing in a text field.

import { useEffect } from 'react';
import { isTextEntryTarget } from '../common/keyboard-targets';
import { useUiStore } from '../state/ui-store';

export const OPERATION_COLOR_PEEK_DELAY_MS = 150;

export function useOperationColorPeek(): void {
  const setPeek = useUiStore((s) => s.setOperationColorPeek);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let chord = false;
    const cancel = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const cancelPeek = (): void => {
      chord = true;
      cancel();
      setPeek(false);
    };
    const pointers = trackPointerGestures(cancelPeek);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt') {
        // Another key joined the Alt press: this is a shortcut, not a peek.
        if (e.altKey) cancelPeek();
        return;
      }
      if (e.repeat || timer !== null || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Option types characters on a Mac, and a held Alt in a field is typing,
      // not a request to recolour the canvas.
      if (isTextEntryTarget(e.target)) return;
      // Alt can join a drag after pointer-down, without another pointer event.
      if (pointers.active()) {
        cancelPeek();
        return;
      }
      chord = false;
      timer = setTimeout(() => {
        timer = null;
        if (!chord) setPeek(true);
      }, OPERATION_COLOR_PEEK_DELAY_MS);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt') return;
      cancel();
      if (!useUiStore.getState().operationColorPeek) return;
      // Releasing a lone Alt moves focus to the browser's own menu; the peek
      // used this press, so keep focus where the user left it.
      e.preventDefault();
      setPeek(false);
    };
    const onBlur = (): void => {
      pointers.clear();
      cancel();
      setPeek(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return (): void => {
      cancel();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      pointers.dispose();
    };
  }, [setPeek]);
}

/** Track presses in capture phase: canvas gestures may stop them bubbling. */
function trackPointerGestures(cancelPeek: () => void) {
  const active = new Set<number>();
  const onDown = (event: PointerEvent): void => {
    active.add(event.pointerId);
    if (event.altKey) cancelPeek();
  };
  const onMove = (event: PointerEvent): void => {
    // A drag can begin outside this window and enter without a pointer-down.
    if (event.buttons === 0) active.delete(event.pointerId);
    else {
      active.add(event.pointerId);
      if (event.altKey) cancelPeek();
    }
  };
  const onEnd = (event: PointerEvent): void => {
    active.delete(event.pointerId);
  };
  const listeners = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onEnd],
    ['pointercancel', onEnd],
  ] as const;
  for (const [type, handler] of listeners) window.addEventListener(type, handler, true);
  return {
    active: () => active.size > 0,
    clear: () => active.clear(),
    dispose: () => {
      active.clear();
      for (const [type, handler] of listeners) window.removeEventListener(type, handler, true);
    },
  };
}
