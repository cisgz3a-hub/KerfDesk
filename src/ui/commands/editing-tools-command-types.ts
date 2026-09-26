// The AppCommandContext slice for LightBurn gap batch 3 (ADR-410), kept in its
// own file so command-types.ts stays inside the size cap.

import type { SelectionAnchor } from '../../core/scene';
import type { QuarterTurnDirection } from '../../core/scene/selection-placement';

export type EditingToolsCommandContext = {
  readonly pasteInPlace: () => void;
  readonly invertSelection: () => void;
  readonly selectOpenShapes: () => void;
  readonly canOffsetShapes: boolean;
  readonly offsetShapes: () => void;
  readonly rotateSelectionQuarterTurn: (direction: QuarterTurnDirection) => void;
  readonly moveSelectionToBed: (anchor: SelectionAnchor) => void;
  readonly wireframeActive: boolean;
  readonly toggleWireframe: () => void;
};

export type EditingToolsCommandId =
  | 'edit.paste-in-place'
  | 'edit.invert-selection'
  | 'edit.select-open-shapes'
  | 'tools.offset-shapes'
  | 'arrange.rotate-90-cw'
  | 'arrange.rotate-90-ccw'
  | 'arrange.move-to-bed-center'
  | 'arrange.move-to-bed-nw'
  | 'arrange.move-to-bed-n'
  | 'arrange.move-to-bed-ne'
  | 'arrange.move-to-bed-w'
  | 'arrange.move-to-bed-e'
  | 'arrange.move-to-bed-sw'
  | 'arrange.move-to-bed-s'
  | 'arrange.move-to-bed-se'
  | 'window.toggle-wireframe';
