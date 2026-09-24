import { useCallback, useMemo } from 'react';
import { cutsLastOrder } from '../../core/cuts-last-order';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import type { SortCutsLastResult } from '../state/operation-panel-actions';
import { useToastStore } from '../state/toast-store';

export type SortCutsLastAction = {
  /** Laser only: CNC already runs profile cuts after clearing. */
  readonly applicable: boolean;
  /** False when every cut already runs after the work it surrounds. */
  readonly available: boolean;
  readonly sort: () => void;
};

/** `evaluate` checks the geometry on every scene change so the control can
 * hide once the order is right. The panel and Run order skip that check (a
 * drag would repeat it) and report through a toast when nothing moves. */
export function useSortCutsLast(evaluate: boolean): SortCutsLastAction {
  const scene = useStore((state) => state.project.scene);
  const layerPriority = useStore((state) => state.project.optimization.layerPriority);
  const applicable = useStore((state) => machineKindOf(state.project.machine) === 'laser');
  const sortCutsLast = useStore((state) => state.sortCutsLast);
  const available = useMemo(
    () => applicable && (!evaluate || cutsLastOrder(scene, layerPriority).sorted !== null),
    [applicable, evaluate, scene, layerPriority],
  );
  const sort = useCallback(() => {
    const result = sortCutsLast();
    useToastStore.getState().pushToast(sortMessage(result), result.moved ? 'success' : 'info');
  }, [sortCutsLast]);
  return { applicable, available, sort };
}

function sortMessage(result: SortCutsLastResult): string {
  const cuts = result.cutOperationCount;
  if (cuts === 0) return 'No Line cut surrounds other work, so the run order stays as it is.';
  if (!result.moved) return 'Every cut already runs after the work it surrounds.';
  return cuts === 1
    ? 'Cuts now run last: the cut operation runs after the work it surrounds.'
    : `Cuts now run last: ${cuts} cut operations run after the work they surround.`;
}
