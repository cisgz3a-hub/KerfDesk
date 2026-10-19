// PlaceBoardCanvas — the Place Board page's canvas (ADR-636): jig mode's
// editing canvas (ADR-641) on the open project, so artwork is dragged, resized
// and rotated on the board the same way, plus the capture marks: the points
// captured so far, the outline they make, the live head or pointer crosshair
// and the board's check points. Edits are ordinary project edits with Undo.

import { useCallback, useMemo } from 'react';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { RegistrationJigCanvas } from '../../workspace/registration-jig/RegistrationJigCanvas';
import type { ViewTransform } from '../../workspace/view-transform';
import { paintPlaceBoardMarks, type PlaceBoardCanvasMarks } from './place-board-canvas-marks';

const BOARD_CANVAS_HELP =
  'Drag artwork to move it · Handles resize and rotate · Drag empty space to box-select · Wheel to zoom · Right-drag or Space-drag to pan';

export function PlaceBoardCanvas(props: {
  readonly marks: PlaceBoardCanvasMarks;
  readonly fitRequest: number;
  readonly readOnly: boolean;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const selectObjects = useStore((state) => state.selectObjects);
  const commit = useStore((state) => state.commitBoardCanvasEdit);
  const selectedIds = useMemo(
    () => new Set([...(primary === null ? [] : [primary]), ...additional]),
    [primary, additional],
  );
  const { marks } = props;
  const paintOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, view: ViewTransform) => paintPlaceBoardMarks(ctx, view, marks),
    [marks],
  );
  return (
    <RegistrationJigCanvas
      project={project}
      selectedIds={selectedIds}
      fitRequest={props.fitRequest}
      readOnly={props.readOnly}
      onSelectionChange={(ids) => selectObjects([...ids])}
      onCommit={(next: Project) => commit(next)}
      paintOverlay={paintOverlay}
      label="Place board canvas"
      help={BOARD_CANVAS_HELP}
      fitLabel="Fit board"
    />
  );
}
