// Builds the batch 5 slice of AppCommandContext (ADR-480) from the stores.

import type { Project } from '../../core/scene';
import { objectVariableTemplate } from '../../core/variables/object-variable-template';
import { bakeSelectedVariableText } from '../app/bake-variable-text';
import { startTwoPointTool } from '../workspace/two-point-tool';
import { useDockOptionsStore } from './dock-options-store';
import { openClosePathsToleranceDialog } from './ClosePathsToleranceDialog';
import { openRadiusFilletDialog } from './RadiusFilletDialog';
import { openShearDialog } from './ShearDialog';
import { useGuideLockStore } from '../workspace/guide-lock-store';
import { openTangentCircleDialog, selectedThreeCircles } from './TangentCircleDialog';
import type { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { openCopyAlongPathDialog } from './copy-along-path-dialog-store';
import type { DesignToolsCommandContext } from './design-tools-command-types';
import type { ParityToolsCommandContext } from './parity-tools-command-types';
import { flattenImageMaskAction } from './image-command-actions';
import { openOptimizeShapesDialog } from './optimize-shapes-dialog-store';
import { vectorCutCommandContext } from './vector-cut-command-context';
import { warpDeformCommandContext } from './warp-deform-command-context';

export function designToolsCommandContext(
  app: ReturnType<typeof useStore.getState>,
  selectedIds: ReadonlyArray<string>,
): Omit<DesignToolsCommandContext, keyof ParityToolsCommandContext> {
  const selected =
    app.project.scene.objects.find((object) => object.id === app.selectedObjectId) ?? null;
  return {
    ...vectorCutCommandContext(app),
    ...warpDeformCommandContext(app.project, selectedIds),
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
    copyAlongPath: openCopyAlongPathDialog,
    optimizeShapes: openOptimizeShapesDialog,
    canBakeVariableText: selectionHasVariableData(app.project, selectedIds),
    bakeVariableText: () => {
      void bakeSelectedVariableText();
    },
    moveSelectionInDrawOrder: app.moveSelectionInDrawOrder,
    matchSelectionSize: app.matchSelectionSize,
    moveSelectionTogether: app.moveSelectionTogether,
    mirrorSelectionAcrossLine: app.mirrorSelectionAcrossLine,
    startTwoPointTransform: startTwoPointTool,
    dockSelection: (direction) =>
      app.dockSelection({ direction, ...useDockOptionsStore.getState().settings }),
    dockOptions: () => useDockOptionsStore.getState().openDialog(),
    hasThreeCircles: selectedThreeCircles(app.project, selectedIds) !== null,
    tangentCircle: openTangentCircleDialog,
    closePathsWithTolerance: openClosePathsToleranceDialog,
    radiusFillet: openRadiusFilletDialog,
    shear: openShearDialog,
    hasGuides: (app.project.guides ?? []).length > 0,
    guidesLocked: useGuideLockStore.getState().locked,
    toggleGuidesLocked: () => useGuideLockStore.getState().toggle(),
    clearGuides: app.clearGuides,
  };
}

function selectionHasVariableData(project: Project, selectedIds: ReadonlyArray<string>): boolean {
  const ids = new Set(selectedIds);
  return project.scene.objects.some(
    (object) =>
      ids.has(object.id) && object.locked !== true && objectVariableTemplate(object) !== undefined,
  );
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
