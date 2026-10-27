// The source for a manual Start from line or Choose restart point (controller
// audit recovery-4). A Current Position job is anchored where the head stood
// when it started. The manual restart recompiled with the live placement, so
// it re-resolved Current Position at wherever the head had stopped: the rest
// of the job burned offset from the part already burned, while the
// confirmation said the machine would move to the recorded position. A reload
// also resets the placement controls, so any mode could differ.
//
// A manual restart now reuses the placement of the newest run that the open
// project reproduces byte for byte: the interrupted run's recovery record, the
// last completed run, or the previous manual restart. With none, it keeps the
// live placement and says where that anchors the job. Nothing here refuses:
// this is the operator's own restart path.
//
// The line it restarts from counts the program prepared here, which is always
// the project's own. A resumed recovery or a painted second pass ran a program
// of its own whose line numbers are not these (rolling audit 2026-10-21,
// 05-P2-1), so the confirmation says which program the line counts.
//
// A Print-and-Cut or variable-text job compiles as Start does (ADR-443
// Amendment 2; rolling audit v4 H2-P1-1). It recompiled without the
// registration, so the rest of the job burned off the print, and ran even
// where Start refuses. The run is now matched with the registration and clock
// it was compiled with. The restart keeps that clock, so dates and times match
// the part already burned, and takes the marks Start would take: the ones
// captured now when they are valid, else the ones the run used. With neither,
// it is refused as Start refuses.

import type { JobOriginPlacement } from '../../core/job';
import { fingerprintGcode, fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';
import type { SimilarityTransform } from '../../core/registration';
import type { OutputScope, Project } from '../../core/scene';
import { projectHasVariableData } from '../../core/variables/object-variable-template';
import { currentOutputScope, useStore } from '../state';
import { recoveryRepository, type RecoveryRepository } from '../state/recovery';
import type { RecoveryArtifactV1 } from '../state/recovery/execution-artifact';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { savedWorkOffsetMm } from './laser-recovery-origin';
import { prepareRecoverySource, type PreparedRecoverySource } from './start-job-source';
import {
  currentTimeBoundStartInputs,
  registrationDisagreementMm,
  restartTimeBoundInputs,
  timeBoundStartInputsFor,
  type TimeBoundStartInputs,
} from './time-bound-start-inputs';

type RunSource = 'interrupted' | 'completed' | 'manual-restart';

type RunPlacement = {
  readonly source: RunSource;
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  /** The program this placement produced, before any resume transform. */
  readonly fingerprint: GcodeFingerprint;
  readonly atIso: string;
  /** The work offset the run ran with, when its archive observed one. */
  readonly savedOffsetMm?: WorkCoordinateOffset | null;
};

export type ManualRestartSource = {
  readonly source: PreparedRecoverySource;
  readonly outputScope: OutputScope;
  /** Where the restart is anchored, in words, for its confirmation. */
  readonly placementNote: string;
  /** Which program the restart line counts, in words, for its confirmation. */
  readonly programNote: string;
  /** Which Print-and-Cut marks or variable-text clock the restart is bound
   * to, for a job whose output depends on them. */
  readonly timeBoundNote?: string;
};

/** What a run's archived bytes are when they are not the project's own
 * program: a resumed recovery or a painted second pass (ADR-341). */
export type DerivedLaserProgram = 'resume' | 'second-pass';

export function derivedLaserProgram(artifact: RecoveryArtifactV1): DerivedLaserProgram | null {
  if (artifact.kind !== 'exact-execution') return null;
  if ((artifact.laserSecondPassChain?.length ?? 0) > 0) return 'second-pass';
  return (artifact.laserResumeChain?.length ?? 0) > 0 ? 'resume' : null;
}

// Session-scoped: a manual restart supersedes the recovery record, so the
// next manual restart of the same job must find its placement here.
let lastManualRestart: RunPlacement | null = null;

export async function prepareManualRestartSource(
  repository: RecoveryRepository = recoveryRepository,
): Promise<ManualRestartSource | null> {
  const project = useStore.getState().project;
  const now = currentTimeBoundStartInputs(project);
  for (const run of runPlacementsNewestFirst(repository)) {
    const remembered = timeBoundStartInputsFor(run.fingerprint);
    const ran = remembered === undefined ? undefined : restartTimeBoundInputs(project, remembered);
    const inputs = ran ?? now;
    // A registered run this session did not compile needs valid marks now.
    if (inputs?.registration === null) continue;
    const source = await prepareRecoverySource(runOverrides(run), inputs);
    if (source === null) return null;
    if (!fingerprintsEqual(fingerprintGcode(source.gcode), run.fingerprint)) continue;
    const restart = await withCurrentMarks(run, source, ran, now);
    if (restart === null) return null;
    return {
      source: restart.source,
      outputScope: run.outputScope,
      placementNote: runPlacementNote(run.jobOrigin),
      programNote: programNote(restart.source, run.source, repository),
      ...timeBoundNoteOption(project, restart.registration, ran, now, false),
    };
  }
  const outputScope = currentOutputScope(useStore.getState());
  // A registration that is not valid is refused here with Start's message.
  const source = await prepareRecoverySource(undefined, now);
  if (source === null) return null;
  return {
    source,
    outputScope,
    placementNote: livePlacementNote(source.jobOrigin),
    programNote: programNote(source, null, repository),
    ...timeBoundNoteOption(project, now?.registration, undefined, now, true),
  };
}

function runOverrides(run: RunPlacement): Parameters<typeof prepareRecoverySource>[0] {
  return {
    outputScope: run.outputScope,
    ...(run.jobOrigin === undefined ? {} : { jobOrigin: run.jobOrigin }),
    savedWorkOffsetMm: run.savedOffsetMm ?? null,
  };
}

type Registration = TimeBoundStartInputs['registration'];

/** The matched run's program, registered to the marks captured now when they
 * are valid and differ from the run's, as Start would register it; the run's
 * clock is kept either way. */
async function withCurrentMarks(
  run: RunPlacement,
  matched: PreparedRecoverySource,
  ran: TimeBoundStartInputs | undefined,
  now: TimeBoundStartInputs | undefined,
): Promise<{
  readonly source: PreparedRecoverySource;
  readonly registration: Registration;
} | null> {
  const matchedRegistration = (ran ?? now)?.registration;
  const current = now?.registration;
  if (ran === undefined || current == null || sameRegistration(current, matchedRegistration)) {
    return { source: matched, registration: matchedRegistration };
  }
  const source = await prepareRecoverySource(runOverrides(run), {
    registration: current,
    evaluatedAtIso: ran.evaluatedAtIso,
  });
  return source === null ? null : { source, registration: current };
}

function sameRegistration(a: Registration, b: Registration): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Which marks the restart is registered to and, when no earlier run was
 * reproduced (`evaluatedNow`), that its variable text was evaluated now. */
function timeBoundNoteOption(
  project: Project,
  registration: Registration,
  ran: TimeBoundStartInputs | undefined,
  now: TimeBoundStartInputs | undefined,
  evaluatedNow: boolean,
): { readonly timeBoundNote?: string } {
  const notes = [
    registration == null ? null : registrationNote(project, registration, ran?.registration, now),
    evaluatedNow && projectHasVariableData(project)
      ? 'Variable text: evaluated now, so a date or time in it can differ from the part already burned.'
      : null,
  ].filter((note): note is string => note !== null);
  return notes.length === 0 ? {} : { timeBoundNote: notes.join(' ') };
}

function registrationNote(
  project: Project,
  registration: SimilarityTransform,
  ranWith: Registration,
  now: TimeBoundStartInputs | undefined,
): string {
  if (now?.registration == null) {
    return 'Print and Cut: registered to the marks that run used, because no marks captured since are current (a reset, reconnect or Home retires them). If the sheet has moved since that run, capture both marks again first.';
  }
  if (ranWith == null) return 'Print and Cut: registered to the marks captured now.';
  const apart = registrationDisagreementMm(project, registration, ranWith);
  return apart < 0.05
    ? "Print and Cut: registered to the marks captured now, which match the run's."
    : `Print and Cut: registered to the marks captured now, which place the job up to ${mm(apart)} mm from where the run's marks placed it. If the sheet has not moved, capture both marks again before you continue.`;
}

/** The notes a manual restart's confirmation carries: the program its line
 * counts, where it is anchored, then the marks and clock it is bound to. */
export function manualRestartNotes(restart: ManualRestartSource): string {
  const notes = `${restart.programNote}\n\n${restart.placementNote}`;
  return restart.timeBoundNote === undefined ? notes : `${notes}\n\n${restart.timeBoundNote}`;
}

/** Remembers the placement a manual restart ran with, for the next one. */
export function noteManualRestartStarted(
  restart: ManualRestartSource,
  atIso = new Date().toISOString(),
): void {
  lastManualRestart = {
    source: 'manual-restart',
    outputScope: restart.outputScope,
    ...(restart.source.jobOrigin === undefined ? {} : { jobOrigin: restart.source.jobOrigin }),
    fingerprint: fingerprintGcode(restart.source.gcode),
    atIso,
  };
}

/** Test seam: a fresh session has no manual restart. */
export function forgetManualRestartsForTests(): void {
  lastManualRestart = null;
}

function runPlacementsNewestFirst(repository: RecoveryRepository): ReadonlyArray<RunPlacement> {
  const snapshot = repository.getSnapshot();
  const capsule = snapshot.recoveryCapsule;
  const receipt = snapshot.lastCompletedReceipt;
  const runs = [
    capsule === null
      ? null
      : artifactPlacement(capsule.artifact, capsule.updatedAtIso, 'interrupted'),
    receipt === null
      ? null
      : artifactPlacement(receipt.artifact, receipt.completedAtIso, 'completed'),
    lastManualRestart,
  ].filter((run): run is RunPlacement => run !== null);
  return [...runs].sort((a, b) => b.atIso.localeCompare(a.atIso));
}

function artifactPlacement(
  artifact: RecoveryArtifactV1,
  atIso: string,
  source: RunSource,
): RunPlacement | null {
  if (artifact.machineKind !== 'laser') return null;
  // A resumed or painted run's bytes are not the project's own program.
  if (derivedLaserProgram(artifact) !== null) return null;
  return {
    source,
    outputScope: artifact.outputScope,
    ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
    fingerprint: artifact.fingerprint,
    atIso,
    savedOffsetMm: savedWorkOffsetMm(artifact),
  };
}

const RUN_PROGRAM: Readonly<Record<RunSource, string>> = {
  interrupted: 'the program the interrupted job ran',
  completed: 'the program the last completed job ran',
  'manual-restart': 'the program the last manual restart replayed',
};

function programNote(
  source: PreparedRecoverySource,
  matched: RunSource | null,
  repository: RecoveryRepository,
): string {
  const lines = source.canvasPlan.fingerprint.lines;
  const program =
    matched === null
      ? `Line numbers count this project's full program as it compiles now (${lines} lines).`
      : `Line numbers count this project's full program (${lines} lines), ${RUN_PROGRAM[matched]}.`;
  const elsewhere = matched === 'interrupted' ? null : interruptedJobNumbering(repository);
  return elsewhere === null ? program : `${program} ${elsewhere}`;
}

/** Why the saved interrupted job's own line numbers are not this program's. */
function interruptedJobNumbering(repository: RecoveryRepository): string | null {
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null || capsule.artifact.machineKind !== 'laser') return null;
  const derived = derivedLaserProgram(capsule.artifact);
  if (derived === null) {
    return "This project no longer reproduces the saved interrupted job's program, so that job's line numbers may point elsewhere here.";
  }
  const ran = derived === 'resume' ? 'a resume program' : 'a painted second pass';
  return `The saved interrupted job ran ${ran}, so its line numbers do not count this program; the Interrupted job saved card's Review restarts it on that program.`;
}

function mm(value: number): string {
  return value.toFixed(1);
}

function runPlacementNote(jobOrigin: JobOriginPlacement | undefined): string {
  if (jobOrigin?.startFrom === 'current-position') {
    const { x, y } = jobOrigin.currentPosition;
    return `Placement: the original run's start point (Current Position X ${mm(x)}, Y ${mm(y)} mm), not where the head is now.`;
  }
  return "Placement: the original run's placement.";
}

function livePlacementNote(jobOrigin: JobOriginPlacement | undefined): string {
  if (jobOrigin?.startFrom === 'current-position') {
    const { x, y } = jobOrigin.currentPosition;
    return (
      'No earlier run of this job was found, so the restart is anchored at the head as it is ' +
      `now (X ${mm(x)}, Y ${mm(y)} mm). Jog the head back to where the job first started ` +
      'before you continue, or the rest of the job burns offset.'
    );
  }
  return 'Placement: the current job placement settings.';
}
