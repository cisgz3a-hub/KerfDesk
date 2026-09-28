// Copy Along Path (LightBurn gap LBG-T09): the guide, the artwork and the copy
// placements for a request, or the reason there are none. The dialog shows the
// same plan the store action carries out.

import { copyAlongPathLayout, type CopyAlongPathSpec } from '../../core/geometry/copy-along-path';
import {
  splitCopyAlongPathSelection,
  type CopyAlongPathSelection,
} from '../../core/geometry/copy-along-path-guide';
import type { ArrayPlacement } from '../../core/scene/array-layout';
import { combinedBBox } from '../../core/scene/hit-test';
import type { SceneObject } from '../../core/scene/scene-object';
import { formatDisplayMillimetres } from '../format-display-millimetres';

export type CopyAlongPathRequest = CopyAlongPathSpec & {
  /** One of the selected single paths; the top-most one when absent. */
  readonly guideId?: string;
  /** Leave the artwork where it was, or replace it with the copies. */
  readonly keepOriginal: boolean;
};

export type ReadyCopyAlongPathSelection = Extract<CopyAlongPathSelection, { kind: 'ok' }>;

export type CopyAlongPathPlan =
  | {
      readonly kind: 'ready';
      readonly selection: ReadyCopyAlongPathSelection;
      readonly placements: ReadonlyArray<ArrayPlacement>;
      readonly stepMm: number | null;
    }
  | { readonly kind: 'problem'; readonly message: string };

/** `selected` in stacking order. */
export function planCopyAlongPath(
  selected: ReadonlyArray<SceneObject>,
  request: CopyAlongPathRequest,
): CopyAlongPathPlan {
  return planForSelection(splitCopyAlongPathSelection(selected, request.guideId), request);
}

/** The plan for a selection already split into guide and artwork. */
export function planForSelection(
  selection: CopyAlongPathSelection,
  request: CopyAlongPathRequest,
): CopyAlongPathPlan {
  if (selection.kind !== 'ok') return { kind: 'problem', message: selectionProblem(selection) };
  const bounds = combinedBBox(selection.artwork);
  if (bounds === null) return { kind: 'problem', message: NO_ARTWORK };
  const layout = copyAlongPathLayout(selection.guide, bounds, request);
  if (layout.kind === 'no-room') {
    const length = formatDisplayMillimetres(selection.guide.walk.lengthMm);
    return {
      kind: 'problem',
      message: `The start and end offsets leave no room on the ${length} mm guide path.`,
    };
  }
  if (layout.kind === 'no-step') {
    const setting = request.mode === 'gap' ? 'gap' : 'spacing';
    return {
      kind: 'problem',
      message: `The copies would all land in one place. Set a ${setting} above 0 mm.`,
    };
  }
  return { kind: 'ready', selection, placements: layout.placements, stepMm: layout.stepMm };
}

/** Why this selection cannot be copied along a path, or null when it can. */
export function copyAlongPathSelectionProblem(selected: ReadonlyArray<SceneObject>): string | null {
  const selection = splitCopyAlongPathSelection(selected);
  return selection.kind === 'ok' ? null : selectionProblem(selection);
}

const NO_ARTWORK = 'Select the artwork to copy as well as the guide path.';

function selectionProblem(selection: Exclude<CopyAlongPathSelection, { kind: 'ok' }>): string {
  switch (selection.kind) {
    case 'no-guide':
      return 'Copy Along Path needs a guide: select the artwork and one open or closed path to copy it along. Text and barcodes are never the guide.';
    case 'zero-length':
      return 'The guide path has no length to copy along.';
    case 'no-artwork':
      return NO_ARTWORK;
  }
}
