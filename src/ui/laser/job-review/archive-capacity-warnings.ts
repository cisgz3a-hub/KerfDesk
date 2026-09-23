// A job whose program text and motion data alone exceed the recovery archive
// budget streams normally, but no recovery copy can be kept: an interruption
// cannot be resumed from a saved copy and the completion darkening offer never
// appears. The operator used to learn that only from a toast after Start
// (ADR-341 Amendment 3). Information only; it never blocks the start.

import type { CanvasMotionPlan } from '../../state/canvas-motion-plan';
import {
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
  stringBytes,
} from '../../state/recovery/execution-artifact-size';
import { packedMotionManifestBytes } from '../../state/recovery/packed-motion-manifest';

const MEGABYTE = 1024 * 1024;

export function detectArchiveCapacityWarnings(prepared: {
  readonly gcode: string;
  readonly canvasPlan: Pick<CanvasMotionPlan, 'manifest'>;
}): ReadonlyArray<string> {
  // The same lower bound the archive itself checks first (execution-artifact.ts).
  const bytes =
    stringBytes(prepared.gcode) + packedMotionManifestBytes(prepared.canvasPlan.manifest);
  if (bytes <= MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES) return [];
  return [
    `This job is too large to keep a recovery copy: its program and motion data need about ` +
      `${Math.ceil(bytes / MEGABYTE)} MB, and a recovery copy holds at most ` +
      `${MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES / MEGABYTE} MB. If the job is interrupted it cannot ` +
      'be resumed from a saved copy, and the offer to darken areas after it finishes will not appear.',
  ];
}
