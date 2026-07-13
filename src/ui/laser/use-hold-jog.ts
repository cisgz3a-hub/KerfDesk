import { useEffect, useRef, type MouseEventHandler, type PointerEventHandler } from 'react';

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
  readonly onStep: () => void;
  readonly onHold: () => void;
  readonly onCancel: () => void;
}): HoldJogHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerActiveRef = useRef(false);
  const holdActiveRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const finishPointer = (runStep: boolean): void => {
    if (!pointerActiveRef.current) return;
    clearTimer();
    pointerActiveRef.current = false;
    suppressClickRef.current = true;
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      args.onCancel();
    } else if (runStep) {
      args.onStep();
    }
  };

  useEffect(() => {
    const cancelForBlur = (): void => finishPointer(false);
    window.addEventListener('blur', cancelForBlur);
    return () => {
      window.removeEventListener('blur', cancelForBlur);
      finishPointer(false);
    };
  });

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
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!pointerActiveRef.current) return;
        holdActiveRef.current = true;
        args.onHold();
      }, HOLD_DELAY_MS);
    },
    onPointerUp: () => finishPointer(true),
    onPointerCancel: () => finishPointer(false),
    onPointerLeave: () => finishPointer(false),
  };
}
