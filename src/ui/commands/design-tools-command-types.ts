// The AppCommandContext slice for LightBurn gap batch 5 (ADR-480), folded into
// the batch 3 slice so command-types.ts and use-app-commands.ts stay as they are.
// Trim Shapes and Cut Shapes (LBG-T04, LBG-T08) and Warp and Deform (LBG-T06)
// join it.

import type { VectorCutCommandContext, VectorCutCommandId } from './vector-cut-command-types';
import type { WarpDeformCommandContext, WarpDeformCommandId } from './warp-deform-command-types';

export type DesignToolsCommandContext = VectorCutCommandContext &
  WarpDeformCommandContext & {
    readonly selectContainedShapes: () => void;
    readonly selectSmallerShapes: () => void;
    readonly deleteDuplicates: () => void;
    readonly canEditSelectedPaths: boolean;
    readonly closeSelectedPaths: () => void;
    readonly reverseSelectedPaths: () => void;
    readonly addRubberBandOutline: () => void;
    readonly flattenImageMask: () => void;
    // LBG-T09: opens the Copy Along Path dialog, or explains why it cannot.
    readonly copyAlongPath: () => void;
  };

export type DesignToolsCommandId =
  | VectorCutCommandId
  | WarpDeformCommandId
  | 'edit.select-contained'
  | 'edit.select-smaller'
  | 'edit.delete-duplicates'
  | 'tools.close-paths'
  | 'tools.reverse-paths'
  | 'tools.rubber-band-outline'
  | 'tools.flatten-image-mask'
  | 'arrange.copy-along-path';
