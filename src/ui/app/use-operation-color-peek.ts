// Hold Alt (Option on a Mac) to see every operation colour on the canvas, and
// let go to return to plain ink (ADR-620). The peek waits a moment and is
// cancelled by another key or pointer gesture, so shortcuts such as Alt+Left
// never flash the colours on the way through.

import { useEffect } from 'react';
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
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt') {
        // Another key joined the Alt press: this is a shortcut, not a peek.
        if (e.altKey) {
          chord = true;
          cancel();
          setPeek(false);
        }
        return;
      }
      if (e.repeat || timer !== null || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
      cancel();
      setPeek(false);
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (!e.altKey) return;
      // Alt-click cycles overlapping artwork and Alt-drag suppresses snapping.
      // Neither is a standalone colour peek, even if its delay already elapsed.
      chord = true;
      cancel();
      setPeek(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointerDown, true);
    return (): void => {
      cancel();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [setPeek]);
}
