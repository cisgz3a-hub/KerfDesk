// use-board-placement — the shared selection gating + placement actions for the
// post-capture controls (ADR-124 / ADR-126), used by both the rectangle
// (BoardPlacementControls) and circle (CircleBoardPlacementControls) variants so
// the "can I align / fit / array" logic lives in one place.

import { findRegistrationBoxes } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';

export function useBoardPlacement() {
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const alignToBox = useStore((s) => s.alignSelectionToRegistrationBox);
  const fitToBoard = useStore((s) => s.fitSelectionToBoard);
  const arrayToBoard = useStore((s) => s.tileSelectionIntoBoard);
  const removeBoard = useStore((s) => s.removeRegistrationBox);
  const jogToPoint = useLaserStore((s) => s.jogToMachinePosition);

  const boxIds = new Set(findRegistrationBoxes(scene).map((b) => b.id));
  const nonBoxSelectedCount = [selectedObjectId, ...additionalSelectedIds].filter(
    (id): id is string => id !== null && !boxIds.has(id),
  ).length;

  return {
    canAlign: boxIds.size > 0 && nonBoxSelectedCount > 0,
    // Fit/array scale or tile ONE design; several would pile up, so require one.
    canFit: boxIds.size > 0 && nonBoxSelectedCount === 1,
    alignToBox,
    fitToBoard,
    arrayToBoard,
    removeBoard,
    jogToPoint,
  };
}
