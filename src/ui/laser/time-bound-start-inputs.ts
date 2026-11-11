// The Print-and-Cut registration and variable-text clock a time-bound compile
// used, keyed by the program it produced (ADR-443 Amendment 2). A manual
// restart recompiles the open project and proves it is the interrupted job by
// reproducing that run's program byte for byte. A registered or variable-text
// job reproduces it only with the run's own inputs: the marks it was
// registered to, and the moment its variable text was evaluated.
//
// Session-scoped, like the marks themselves (print-cut-session-store): after
// an app restart the sealed recovery card replays the run as it was.

import { fingerprintGcode, type GcodeFingerprint } from '../../core/recovery';
import { applySimilarityPoint, type SimilarityTransform } from '../../core/registration';
import type { Project } from '../../core/scene';
import { projectHasVariableData } from '../../core/variables/object-variable-template';
import type { OutputSnapshotRequest } from './output-preparation-protocol';
import { currentPrintCutOutputRegistration, printCutOutputSwitchedOff } from './print-cut-output';
import type { StartJobPreparation } from './start-job-readiness';
import { maxOf } from '../../core/util';

export type TimeBoundStartInputs = {
  /** Undefined: the project takes no registration. Null: it takes one, and
   * no valid one exists, which the compile refuses as Start does. */
  readonly registration: SimilarityTransform | null | undefined;
  readonly evaluatedAtIso: string;
};

/** True when a compile of this project is bound to the moment it ran — a
 * Print-and-Cut registration or variable text evaluated against a clock — so
 * its bytes cannot be reused by a later Start from unchanged inputs. */
export function startPreparationIsTimeBound(project: Project): boolean {
  return (
    currentPrintCutOutputRegistration(project) !== undefined || projectHasVariableData(project)
  );
}

/** The registration and clock Start would compile this project with now;
 * undefined when its compile is not time-bound. */
export function currentTimeBoundStartInputs(project: Project): TimeBoundStartInputs | undefined {
  if (!startPreparationIsTimeBound(project)) return undefined;
  return {
    registration: currentPrintCutOutputRegistration(project),
    evaluatedAtIso: new Date().toISOString(),
  };
}

/** The inputs a restart compiles this project with from those an earlier run
 * used: that run's clock, and its marks only where Start would register the
 * project at all. A project that takes a registration is never compiled
 * without one, and none is valid while Labs has Print and Cut switched off. */
export function restartTimeBoundInputs(
  project: Project,
  ran: TimeBoundStartInputs,
): TimeBoundStartInputs | undefined {
  const now = currentTimeBoundStartInputs(project);
  if (now === undefined) return undefined;
  const registration =
    now.registration === undefined
      ? undefined
      : printCutOutputSwitchedOff(project)
        ? null
        : (ran.registration ?? now.registration);
  return { registration, evaluatedAtIso: ran.evaluatedAtIso };
}

/** The snapshot a time-bound compile evaluates with, at `evaluatedAtIso` or
 * now; none for any other compile. */
export function startSnapshotRequest(args: {
  readonly useSnapshot: boolean;
  readonly registration: TimeBoundStartInputs['registration'];
  readonly evaluatedAtIso?: string;
}): OutputSnapshotRequest | undefined {
  if (!args.useSnapshot) return undefined;
  return {
    evaluatedAtIso: args.evaluatedAtIso ?? new Date().toISOString(),
    ...(args.registration === undefined ? {} : { registration: args.registration }),
  };
}

/** Remembers the inputs of a successful time-bound compile. */
export function rememberSnapshotCompile(
  prepared: StartJobPreparation,
  snapshot: OutputSnapshotRequest,
): void {
  if (!prepared.ok) return;
  rememberTimeBoundStartInputs(prepared.gcode, {
    registration: snapshot.registration,
    evaluatedAtIso: snapshot.evaluatedAtIso,
  });
}

/** A registered or variable-text job's recovery compiles as Start does, with
 * the inputs that reproduce the run's program (ADR-443 Amendment 2): never
 * unregistered, never with its template text. Any other job compiles without
 * a snapshot. */
export function recoverySnapshotArgs(timeBound: TimeBoundStartInputs | undefined): {
  readonly registration: TimeBoundStartInputs['registration'];
  readonly useSnapshot: boolean;
  readonly evaluatedAtIso?: string;
} {
  return timeBound === undefined
    ? { registration: undefined, useSnapshot: false }
    : { ...timeBound, useSnapshot: true };
}

/** The inputs a recovery compile uses: an earlier run's when given, else the
 * ones Start would use now. */
export function recoveryTimeBoundInputs(
  project: Project,
  ran: TimeBoundStartInputs | undefined,
): TimeBoundStartInputs | undefined {
  return ran === undefined
    ? currentTimeBoundStartInputs(project)
    : restartTimeBoundInputs(project, ran);
}

// Frame and Start each compile a time-bound job afresh; a few dozen covers
// the compiles of one session's recent runs.
const REMEMBERED_COMPILES = 32;
const remembered = new Map<string, TimeBoundStartInputs>();

function key(fingerprint: GcodeFingerprint): string {
  return `${fingerprint.fnv1a}:${fingerprint.chars}:${fingerprint.lines}`;
}

/** Remembers the inputs a time-bound compile produced `gcode` from. */
export function rememberTimeBoundStartInputs(gcode: string, inputs: TimeBoundStartInputs): void {
  const id = key(fingerprintGcode(gcode));
  remembered.delete(id);
  remembered.set(id, inputs);
  while (remembered.size > REMEMBERED_COMPILES) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** The inputs this session compiled the program with `fingerprint` from. */
export function timeBoundStartInputsFor(
  fingerprint: GcodeFingerprint,
): TimeBoundStartInputs | undefined {
  return remembered.get(key(fingerprint));
}

/**
 * The variable-text clock the program on screen was compiled with, as a
 * preparation hook. Job Review recompiled at each Confirm with a fresh clock
 * and never reproduced a shown seconds field, so the review could not be
 * confirmed (oracle audit O1, O5-P2-2). Its rebuild keeps the shown clock, so
 * the burn carries the date and time the operator approved.
 */
export function shownProgramClock(gcode: string): { readonly evaluatedAtIso?: string } {
  const shown = remembered.get(key(fingerprintGcode(gcode)));
  return shown === undefined ? {} : { evaluatedAtIso: shown.evaluatedAtIso };
}

/** Test seam: a fresh session has compiled nothing. */
export function forgetTimeBoundStartInputsForTests(): void {
  remembered.clear();
}

/** How far apart two registrations put the project's design targets, in mm:
 * the larger of the two target displacements. */
export function registrationDisagreementMm(
  project: Project,
  a: SimilarityTransform,
  b: SimilarityTransform,
): number {
  const targets = project.printAndCutTargets;
  if (targets === undefined) return 0;
  return maxOf(
    [targets.first, targets.second].map((point) => {
      const left = applySimilarityPoint(point, a);
      const right = applySimilarityPoint(point, b);
      return Math.hypot(left.x - right.x, left.y - right.y);
    }),
  );
}
