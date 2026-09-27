// The selected design as the piece fill sees it (ADR-442): the box around the
// selection in the design's own frame, or null when nothing is selected.

import { designFrame } from '../../../core/camera/pieces/design-frame';
import type { DesignFrame } from '../../../core/camera/pieces/piece-placements';
import type { Project } from '../../../core/scene';

export function selectionFrame(
  project: Project,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): DesignFrame | null {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  return designFrame(project.scene.objects.filter((object) => ids.has(object.id)));
}
