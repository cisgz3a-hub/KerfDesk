import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import {
  canvasTextSessionIsCurrent,
  useCanvasTextStore,
  type CanvasTextSession,
} from './canvas-text-store';

export function useCanvasTextLifecycle(options: {
  readonly session: CanvasTextSession;
  readonly input: React.RefObject<HTMLTextAreaElement>;
  readonly editor: React.RefObject<HTMLDivElement>;
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly save: () => Promise<void>;
  readonly cancel: () => void;
}): void {
  const latest = useRef(options);
  const lifetime = useRef({ generation: 0 }).current;
  latest.current = options;
  const { session, input } = options;
  useEffect(() => {
    const generation = ++lifetime.generation;
    input.current?.focus();
    const length = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(length, length);
    const unsubscribe = useStore.subscribe(() => {
      if (!canvasTextSessionIsCurrent(session)) latest.current.cancel();
    });
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target !== latest.current.canvasRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Finish native composition/blur before capturing the final content.
      input.current?.blur();
      window.requestAnimationFrame(() => void latest.current.save());
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown, true);
      // StrictMode replays effects on mount. Only a lasting unmount closes
      // the session; replay increments the generation before this runs.
      queueMicrotask(() => {
        if (
          lifetime.generation === generation &&
          useCanvasTextStore.getState().session === session
        ) {
          useCanvasTextStore.getState().close();
        }
      });
    };
  }, [session, input, lifetime]);
  useEffect(
    () =>
      useUiStore.subscribe((next, previous) => {
        if (next.toolMode !== previous.toolMode && next.toolMode.kind !== 'text') {
          void latest.current.save();
        }
      }),
    [],
  );
}
