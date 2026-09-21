// start-intent — the cheap durable record that stands in for the execution
// archive between the operator's Start and the controller's acceptance
// (ADR-337).
//
// The archive itself embeds the canvas motion plan, which holds one object per
// motion vertex, so building and storing it is proportional to the job's
// geometry. Writing it before the first wire byte put that cost between the
// operator's click and any motion. A start intent carries only what crash
// reconciliation needs to tell the operator the truth — which program, how
// long, where it was going to run — and costs two linear scans of the emitted
// G-code and a handful of bytes.
//
// It is deliberately a `JobCheckpoint`: that shape already has a strict parser,
// an artifact converter (`legacyArtifact`) and a capsule writer, all of which
// the legacy-checkpoint migration has exercised since ADR-118. Reusing it keeps
// this decision from adding a second recovery payload format.

import {
  createJobCheckpoint,
  parseJobCheckpoint,
  serializeJobCheckpoint,
  withJobInterruption,
  type JobCheckpoint,
  type JobMachineKind,
} from '../../../core/recovery';
import type { JobOriginPlacement } from '../../../core/job';
import type { OutputScope } from '../../../core/scene';
import type { LegacyFingerprintOnlyArtifactV1 } from './execution-artifact';
import { legacyArtifact } from './legacy-checkpoint-migration';

/** What the operator is told when the app died inside the arming window. The
 * app cannot distinguish "nothing was sent" from "the controller took the
 * program and started cutting", so it must not claim either. */
export const START_INTENT_INTERRUPTION_MESSAGE =
  'The application restarted while Start was being accepted. Motion may or may not have begun.';

/** Build the pre-wire intent for an ordinary fresh Start. The interruption is
 * stamped at creation: this record only ever becomes visible to an operator
 * along the path where the app did not survive to accept the run, so its
 * meaning is fixed the moment it is written. */
export function createStartIntent(args: {
  readonly gcode: string;
  readonly machineKind: JobMachineKind;
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  readonly nowIso: string;
}): JobCheckpoint {
  const checkpoint = createJobCheckpoint({
    gcode: args.gcode,
    machineKind: args.machineKind,
    outputScope: args.outputScope,
    ...(args.jobOrigin === undefined ? {} : { jobOrigin: args.jobOrigin }),
    nowIso: args.nowIso,
  });
  return withJobInterruption(
    checkpoint,
    { kind: 'unknown', message: START_INTENT_INTERRUPTION_MESSAGE },
    args.nowIso,
  );
}

/** Strict parse of a persisted intent. Routes through the checkpoint parser so
 * a malformed, truncated or future-schema intent reads as absent rather than
 * as a resumable run. */
export function parseStartIntent(value: unknown): JobCheckpoint | null {
  if (value === undefined || value === null) return null;
  try {
    return parseJobCheckpoint(serializeJobCheckpoint(value as JobCheckpoint));
  } catch {
    return null;
  }
}

/** Parse the optional intent on a persisted `pendingStart`. An intent that
 * does not parse, or that disagrees with the handoff it is attached to, fails
 * the whole record closed (`undefined`): half a durable Start record is worse
 * than none, because reconciliation would then report a program length the
 * operator never authorized. */
export function parsePendingStartIntent(
  value: unknown,
  sendableLines: number,
): { readonly intent?: JobCheckpoint } | undefined {
  if (value === undefined) return {};
  const intent = parseStartIntent(value);
  if (intent === null || intent.sendableLines !== sendableLines) return undefined;
  return { intent };
}

/** The fingerprint-only stand-in an interrupted intent becomes, so the capsule
 * reconciliation writes points at a real artifact instead of a run the next
 * hydration would drop. `legacyArtifact` builds the same shape for the ADR-118
 * checkpoint migration; the `legacy` in that name is historical. */
export function startIntentStandInArtifact(
  runId: string,
  intent: JobCheckpoint,
  nowIso: string,
): LegacyFingerprintOnlyArtifactV1 {
  return { ...legacyArtifact(intent, nowIso), runId };
}
