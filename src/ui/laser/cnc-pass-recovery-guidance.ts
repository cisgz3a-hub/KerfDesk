// Extraction guidance per interruption cause (ADR-215). This is operator
// coaching only — the app never commands extraction motion itself, because a
// stationary embedded cutter must not be machine-retracted (the ADR-136 →
// ADR-143 lesson). Z jog stays available for the operator's own extraction.

import type { JobInterruptionKind } from '../../core/recovery';
import { assertNever } from '../../core/scene';

export type CncExtractionGuidance = {
  readonly title: string;
  readonly spindleNote: string;
  readonly steps: ReadonlyArray<string>;
};

const SPINDLE_LIKELY_RUNNING =
  'GRBL latches M3, so if the controller kept power the spindle may STILL BE SPINNING and ' +
  'dwelling in the cut — burning wood until you act.';
const SPINDLE_STOPPED =
  'The spindle stopped with this interruption. Never restart it while the cutter is embedded — ' +
  'the flutes grab.';

const EXTRACT_WHILE_SPINNING =
  'If the spindle is still spinning: jog Z up now — a spinning bit lifts out of the kerf ' +
  'cleanly. Stop the spindle only after the cutter is clear.';
const EXTRACT_STOPPED =
  'If the spindle stopped while embedded: leave it off, then free the cutter by loosening the ' +
  'collet, or by rotating the spindle by hand while lifting Z. Do not power the spindle to free it.';
const CONFIRM_AFTER =
  'With the cutter clear and the spindle stopped, check the tool for damage and confirm the ' +
  'stock never shifted in its clamps.';

export function cncExtractionGuidance(kind: JobInterruptionKind): CncExtractionGuidance {
  switch (kind) {
    case 'disconnect':
    case 'write-failed':
    case 'stream-stalled':
    case 'unknown':
      return {
        title: 'The app lost the controller mid-job',
        spindleNote: SPINDLE_LIKELY_RUNNING,
        steps: [EXTRACT_WHILE_SPINNING, EXTRACT_STOPPED, CONFIRM_AFTER],
      };
    case 'controller-reboot':
      return {
        title: 'The controller rebooted mid-job',
        spindleNote:
          `${SPINDLE_STOPPED} The reboot also cleared machine position, so the XY/Z zero must be ` +
          're-established before recovery.',
        steps: [EXTRACT_STOPPED, CONFIRM_AFTER],
      };
    case 'controller-error':
      return {
        title: 'The controller rejected the stream',
        spindleNote:
          'An alarm or error stopped the job; the spindle state depends on the fault. Treat the ' +
          'cutter as embedded until you have inspected it.',
        steps: [EXTRACT_WHILE_SPINNING, EXTRACT_STOPPED, CONFIRM_AFTER],
      };
    case 'cancelled':
      return {
        title: 'The job was stopped from the app',
        spindleNote:
          'Stop commands the spindle off, but verify it physically before touching anything.',
        steps: [EXTRACT_STOPPED, CONFIRM_AFTER],
      };
    default:
      return assertNever(kind, 'JobInterruptionKind');
  }
}
