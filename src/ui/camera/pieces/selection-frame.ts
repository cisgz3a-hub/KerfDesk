// The selected design as the piece fill sees it (ADR-442): the centre and
// size of the selection's bounds, or null when nothing is selected.

import type { DesignFrame } from '../../../core/camera/pieces/piece-placements';
import { combinedBBox, type Project } from '../../../core/scene';

export function selectionFrame(
  project: Project,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): DesignFrame | null {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  const bounds = combinedBBox(project.scene.objects.filter((object) => ids.has(object.id)));
  if (bounds === null) return null;
  return {
    centre: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}
