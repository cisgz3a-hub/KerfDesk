// Hold Alt (Option on a Mac) to see every operation colour on the canvas, and
// let go to return to plain ink (ADR-620). The peek waits a moment and is
// cancelled by any other key or an Alt click or drag, so Alt shortcuts such as
// Alt+Left (align left) and Alt-drags never flash the colours on the way through.

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
    // Alt is serving another command (a shortcut, or no-snap / cycle-overlaps
    // on a click or drag): no peek for the rest of this press.
    const altUsedElsewhere = (): void => {
      chord = true;
      cancel();
      setPeek(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt') {
        if (e.altKey) altUsedElsewhere();
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
    const onPointerDown = (e: PointerEvent): void => {
      if (e.altKey) altUsedElsewhere();
    };
    const onBlur = (): void => {
      cancel();
      setPeek(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Capture: the canvas may stop the press from bubbling.
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return (): void => {
      cancel();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [setPeek]);
}
