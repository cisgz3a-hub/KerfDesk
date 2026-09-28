// A job whose program text and motion data alone exceed the recovery archive
// budget streams normally, but no recovery copy can be kept: an interruption
// cannot be resumed from a saved copy. The completion darkening offer still
// appears, from the copy this page keeps until another job starts or the page
// closes (ADR-341 Amendment 7). The operator used to learn that only from a
// toast after Start (ADR-341 Amendment 3). Information only; it never blocks
// the start. A laser job still keeps a short record of an interruption
// (Amendment 8).

import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import {
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
  stringBytes,
} from '../../state/recovery/execution-artifact-size';
import { packedMotionManifestBytes } from '../../state/recovery/packed-motion-manifest';

const MEGABYTE = 1024 * 1024;

export function detectArchiveCapacityWarnings(
  prepared: {
    readonly gcode: string;
    readonly canvasPlan: Pick<CanvasMotionPlan, 'manifest'>;
  },
  /** True for a laser job, which keeps a short record instead; a painted
   * second pass does not, since no project reproduces it. */
  keepsShortRecord = false,
): ReadonlyArray<string> {
  // The same lower bound the archive itself checks first (execution-artifact.ts).
  const bytes =
    stringBytes(prepared.gcode) + packedMotionManifestBytes(prepared.canvasPlan.manifest);
  if (bytes <= MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES) return [];
  return [
    `This job is too large to keep a recovery copy: its program and motion data need about ` +
      `${Math.ceil(bytes / MEGABYTE)} MB, and a recovery copy holds at most ` +
      `${MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / MEGABYTE} MB. ` +
      interruptedSentence(keepsShortRecord) +
      ' The offer to darken areas after it finishes still appears until you start another job ' +
      'or close KerfDesk.',
  ];
}

// A laser job keeps a short record instead: its origin and where it stopped
// (ADR-341 Amendment 8).
function interruptedSentence(keepsShortRecord: boolean): string {
  return keepsShortRecord
    ? 'If the job is interrupted, KerfDesk keeps only its origin and where it stopped, and the ' +
        'Review continues it from this project while the project still produces the same program.'
    : 'If the job is interrupted it cannot be resumed from a saved copy.';
}
