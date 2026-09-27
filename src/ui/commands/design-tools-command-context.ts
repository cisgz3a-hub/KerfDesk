// Builds the batch 5 slice of AppCommandContext (ADR-480) from the stores.

import type { Project } from '../../core/scene';
import type { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import type { DesignToolsCommandContext } from './design-tools-command-types';
import { flattenImageMaskAction } from './image-command-actions';

export function designToolsCommandContext(
  app: ReturnType<typeof useStore.getState>,
  selectedIds: ReadonlyArray<string>,
): DesignToolsCommandContext {
  const selected =
    app.project.scene.objects.find((object) => object.id === app.selectedObjectId) ?? null;
  return {
    selectContainedShapes: app.selectContainedShapes,
    selectSmallerShapes: app.selectSmallerShapes,
    deleteDuplicates: app.deleteDuplicates,
    canEditSelectedPaths: selectionHasEditablePaths(app.project, selectedIds),
    closeSelectedPaths: app.closeSelectedPaths,
    reverseSelectedPaths: app.reverseSelectedPaths,
    addRubberBandOutline: () => {
      app.addRubberBandOutline();
    },
    flattenImageMask: flattenImageMaskAction(app, selected, (message, kind) =>
      useToastStore.getState().pushToast(message, kind),
    ),
  };
}

// The artwork Close Path and Reverse Direction can edit: unlocked imported or
// traced artwork, or a drawn polyline.
function selectionHasEditablePaths(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const ids = new Set(selectedIds);
  return project.scene.objects.some(
    (object) =>
      ids.has(object.id) &&
      object.locked !== true &&
      (object.kind === 'imported-svg' ||
        object.kind === 'traced-image' ||
        (object.kind === 'shape' && object.spec.kind === 'polyline')),
  );
}
