import {
  useCallback,
  useEffect,
  useRef,
  type MouseEventHandler,
  type PointerEventHandler,
} from 'react';

const HOLD_DELAY_MS = 250;

export type HoldJogHandlers = {
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
  readonly onPointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerUp: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerLeave: PointerEventHandler<HTMLButtonElement>;
};

export function useHoldJog(args: {
  readonly disabled: boolean;
  // When false, the press-and-hold continuous jog is not armed: the controller
  // cannot cancel an in-flight jog (no realtime jog-cancel byte), so a
  // boundary-length continuous move would be physically unstoppable on release
  // (F101). The arrow degrades to a single step per press.
  readonly holdEnabled: boolean;
  readonly onStep: () => void;
  readonly onHold: () => void;
  readonly onCancel: () => void;
}): HoldJogHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerActiveRef = useRef(false);
  const holdActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const finishPointer = useCallback(
    (runStep: boolean): void => {
      if (!pointerActiveRef.current) return;
      clearTimer();
      pointerActiveRef.current = false;
      suppressClickRef.current = true;
      if (holdActiveRef.current) {
        holdActiveRef.current = false;
        argsRef.current.onCancel();
      } else if (runStep) {
        argsRef.current.onStep();
      }
    },
    [clearTimer],
  );

  useEffect(() => {
    const cancelForBlur = (): void => finishPointer(false);
    window.addEventListener('blur', cancelForBlur);
    return () => {
      window.removeEventListener('blur', cancelForBlur);
      finishPointer(false);
    };
  }, [finishPointer]);

  return {
    onClick: () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!args.disabled) args.onStep();
    },
    onPointerDown: (event) => {
      if (args.disabled || event.button !== 0) return;
      pointerActiveRef.current = true;
      holdActiveRef.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (!args.holdEnabled) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!pointerActiveRef.current) return;
        holdActiveRef.current = true;
        argsRef.current.onHold();
      }, HOLD_DELAY_MS);
    },
    onPointerUp: () => finishPointer(true),
    onPointerCancel: () => finishPointer(false),
    onPointerLeave: () => finishPointer(false),
  };
}
