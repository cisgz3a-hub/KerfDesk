// board-capture-actions — commit a captured board (ADR-124). Builds the
// registration box from the operator's measured width/height, centers it on the
// bed, and configures the burn so the next Start lands the artwork on the real
// board: box output OFF (the material is already placed, so the outline is a
// guide, not a jig to burn) and job placement switched to user-origin/front-left
// (anchoring every run to the box front-left = the G92 work origin the capture
// flow set at the physical bottom-left corner).

import { createRegistrationBox } from '../../core/shapes';
import { DEFAULT_JOB_PLACEMENT, type JobPlacementSettings } from '../job-placement';
import {
  applyAddRegistrationBox,
  registrationBoxDefaultPosition,
} from './registration-box-actions';
import { applyRegistrationOutputToScene } from './registration-output-actions';
import type { AppState } from './store';

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

// Anchor every run to the board's front-left corner = the G92 work origin the
// capture flow set at the physical bottom-left corner.
const CAPTURED_BOARD_PLACEMENT: JobPlacementSettings = {
  ...DEFAULT_JOB_PLACEMENT,
  startFrom: 'user-origin',
  anchor: 'front-left',
};

export function boardCaptureActions(set: Setter): Pick<AppState, 'addCapturedBoardBox'> {
  return {
    addCapturedBoardBox: (widthMm: number, heightMm: number) => {
      set((s) => {
        // A capture is always a brand-new board, so center it fresh rather than
        // preserving any prior box position (unlike addRegistrationBox's resize).
        const { bedWidth, bedHeight } = s.project.device;
        const position = registrationBoxDefaultPosition(bedWidth, bedHeight, widthMm, heightMm);
        const box = createRegistrationBox({ widthMm, heightMm, x: position.x, y: position.y });
        const added = applyAddRegistrationBox(s, box);
        // Guide, not a jig: keep the outline out of the burn. Next Start burns
        // only the artwork (once the operator adds and positions it).
        const scene = applyRegistrationOutputToScene(added.project.scene, 'artwork');
        return {
          ...added,
          project: { ...added.project, scene },
          jobPlacement: CAPTURED_BOARD_PLACEMENT,
          // Forcing artwork scope directly (not via setRegistrationOutput) must
          // still honor its invariant — artwork scope owns no saved snapshot —
          // or a stale one from a prior "burn box only" toggle could later
          // clobber the artwork layers' output.
          registrationArtworkOutputSnapshot: null,
        };
      });
    },
  };
}
