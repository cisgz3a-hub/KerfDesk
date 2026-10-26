// Pointing at an operation row pulses its artwork on the canvas once (ADR-620).
// The pointer must settle on the row first, so sweeping down the list does not
// set off a pulse per row. Keyboard focus within the row does the same, so the
// pulse is not pointer-only now that artwork rests in ink. Display only:
// nothing is selected or changed.

import { useEffect, useRef } from 'react';
import { PULSE_HOVER_DWELL_MS } from '../workspace/artwork-pulse';
import { useUiStore } from '../state/ui-store';

export function useOperationRowHover(
  operationId: string,
  /**
   * The row's own controls hold an edit glow (ADR-646 Amendment 1). The row
   * steps aside for it: the edit lights exactly what it changes, where the
   * row pulse widens to every operation with the same settings.
   */
  editing = false,
): {
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: React.FocusEvent<HTMLElement>) => void;
} {
  const setHovered = useUiStore((state) => state.setHoveredOperationId);
  const release = useUiStore((state) => state.releaseHoveredOperationId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingNow = useRef(editing);
  editingNow.current = editing;
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
  useEffect(() => {
    if (!editing) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    release(operationId);
  }, [editing, operationId, release]);
  const settle = (): void => {
    cancel();
    timer.current = setTimeout(() => {
      if (!editingNow.current) setHovered(operationId);
    }, PULSE_HOVER_DWELL_MS);
  };
  const leave = (): void => {
    cancel();
    release(operationId);
  };
  return {
    onPointerEnter: settle,
    onPointerLeave: leave,
    // Focus moving between the row's own controls stays on the row; a settled
    // pulse is not restarted, because the hovered id does not change.
    onFocus: settle,
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leave();
    },
  };
}
