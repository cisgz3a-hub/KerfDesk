// Pointing at an operation row pulses its artwork on the canvas once (ADR-620).
// The pointer must settle on the row first, so sweeping down the list does not
// set off a pulse per row. Display only: nothing is selected or changed.

import { useEffect, useRef } from 'react';
import { PULSE_HOVER_DWELL_MS } from '../workspace/artwork-pulse';
import { useUiStore } from '../state/ui-store';

export function useOperationRowHover(operationId: string): {
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
} {
  const setHovered = useUiStore((state) => state.setHoveredOperationId);
  const release = useUiStore((state) => state.releaseHoveredOperationId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  // A row removed under the pointer gets no pointerleave.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      release(operationId);
    },
    [operationId, release],
  );
  return {
    onPointerEnter: () => {
      cancel();
      timer.current = setTimeout(() => setHovered(operationId), PULSE_HOVER_DWELL_MS);
    },
    onPointerLeave: () => {
      cancel();
      release(operationId);
    },
  };
}
