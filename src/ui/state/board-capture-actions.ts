// board-capture-actions — commit a captured board (ADR-124, generalized to a
// board-shape union in ADR-126). Builds a registration outline (rectangle or
// circle) from the operator's measured size, centers it fresh on the bed, locks
// it, keeps the outline out of the burn, and anchors the next Start to the work
// origin — a rectangle's front-left (the G92 origin at the physical bottom-left
// corner) or a circle's centre (the G92 origin at the physical centre).

import { assertNever, type BoardShape, type ShapeObject } from '../../core/scene';
import { createRegistrationBox, createRegistrationCircle } from '../../core/shapes';
import { DEFAULT_JOB_PLACEMENT, type JobPlacementSettings } from '../job-placement';
import {
  applyAddRegistrationBox,
  registrationBoxDefaultPosition,
} from './registration-box-actions';
import { applyRegistrationOutputToScene } from './registration-output-actions';
import type { AppState } from './store';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

// Anchor every run to the board's registration origin. Rectangle: front-left =
// the G92 origin the capture set at the physical bottom-left corner. Circle:
// centre = the G92 origin the capture set at the physical centre.
const CAPTURED_RECT_PLACEMENT: JobPlacementSettings = {
  ...DEFAULT_JOB_PLACEMENT,
  startFrom: 'user-origin',
  anchor: 'front-left',
};
const CAPTURED_CIRCLE_PLACEMENT: JobPlacementSettings = {
  ...DEFAULT_JOB_PLACEMENT,
  startFrom: 'user-origin',
  anchor: 'center',
};

export function boardCaptureActions(
  set: Setter,
): Pick<AppState, 'addCapturedBoard' | 'addCapturedBoardBox'> {
  const addCapturedBoard = (shape: BoardShape): void => {
    set((s) => commitCapturedBoard(s, buildBoardOutline(s, shape), placementFor(shape)));
  };
  return {
    addCapturedBoard,
    // Back-compat: the four-corner / manual-size path is always a rectangle.
    addCapturedBoardBox: (widthMm, heightMm) =>
      addCapturedBoard({ kind: 'rect', widthMm, heightMm }),
  };
}

// Build the locked registration outline for the captured shape, centered fresh on
// the bed (a capture is always a brand-new board, so no prior position is kept).
// Locked so a stray drag can't shift it off registration — its canvas position
// encodes the physical work origin.
function buildBoardOutline(s: AppState, shape: BoardShape): ShapeObject {
  const { bedWidth, bedHeight } = s.project.device;
  switch (shape.kind) {
    case 'rect': {
      const { widthMm, heightMm } = shape;
      const at = registrationBoxDefaultPosition(bedWidth, bedHeight, widthMm, heightMm);
      return locked(createRegistrationBox({ widthMm, heightMm, x: at.x, y: at.y }));
    }
    case 'circle': {
      const { diameterMm } = shape;
      const at = registrationBoxDefaultPosition(bedWidth, bedHeight, diameterMm, diameterMm);
      return locked(createRegistrationCircle({ diameterMm, x: at.x, y: at.y }));
    }
    default:
      return assertNever(shape, 'BoardShape');
  }
}

function placementFor(shape: BoardShape): JobPlacementSettings {
  switch (shape.kind) {
    case 'rect':
      return CAPTURED_RECT_PLACEMENT;
    case 'circle':
      return CAPTURED_CIRCLE_PLACEMENT;
    default:
      return assertNever(shape, 'BoardShape');
  }
}

function locked(box: ShapeObject): ShapeObject {
  return { ...box, locked: true };
}

// Add the outline as the single registration box, force its output OFF (guide,
// not a jig — the material is already placed), and anchor the next Start to the
// work origin. Clearing registrationArtworkOutputSnapshot honors the artwork-
// scope invariant (no saved snapshot) so a stale "burn box only" toggle can't
// later clobber the artwork layers' output.
function commitCapturedBoard(
  s: AppState,
  box: ShapeObject,
  placement: JobPlacementSettings,
): AppState | Partial<AppState> {
  const added = applyAddRegistrationBox(s, box);
  const scene = applyRegistrationOutputToScene(added.project.scene, 'artwork');
  return {
    ...added,
    project: { ...added.project, scene },
    jobPlacement: placement,
    registrationArtworkOutputSnapshot: null,
  };
}
