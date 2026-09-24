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

import type { JobOriginPlacement } from '../../core/job';
import { fingerprintGcode, fingerprintsEqual, type GcodeFingerprint } from '../../core/recovery';
import type { OutputScope } from '../../core/scene';
import { currentOutputScope, useStore } from '../state';
import { recoveryRepository, type RecoveryRepository } from '../state/recovery';
import type { RecoveryArtifactV1 } from '../state/recovery/execution-artifact';
import { prepareRecoverySource, type PreparedRecoverySource } from './start-job-source';

type RunPlacement = {
  readonly outputScope: OutputScope;
  readonly jobOrigin?: JobOriginPlacement;
  /** The program this placement produced, before any resume transform. */
  readonly fingerprint: GcodeFingerprint;
  readonly atIso: string;
};

export type ManualRestartSource = {
  readonly source: PreparedRecoverySource;
  readonly outputScope: OutputScope;
  /** Where the restart is anchored, in words, for its confirmation. */
  readonly placementNote: string;
};

// Session-scoped: a manual restart supersedes the recovery record, so the
// next manual restart of the same job must find its placement here.
let lastManualRestart: RunPlacement | null = null;

export async function prepareManualRestartSource(
  repository: RecoveryRepository = recoveryRepository,
): Promise<ManualRestartSource | null> {
  for (const run of runPlacementsNewestFirst(repository)) {
    const source = await prepareRecoverySource({
      outputScope: run.outputScope,
      ...(run.jobOrigin === undefined ? {} : { jobOrigin: run.jobOrigin }),
    });
    if (source === null) return null;
    if (fingerprintsEqual(fingerprintGcode(source.gcode), run.fingerprint)) {
      return {
        source,
        outputScope: run.outputScope,
        placementNote: runPlacementNote(run.jobOrigin),
      };
    }
  }
  const outputScope = currentOutputScope(useStore.getState());
  const source = await prepareRecoverySource();
  if (source === null) return null;
  return { source, outputScope, placementNote: livePlacementNote(source.jobOrigin) };
}

/** Remembers the placement a manual restart ran with, for the next one. */
export function noteManualRestartStarted(
  restart: ManualRestartSource,
  atIso = new Date().toISOString(),
): void {
  lastManualRestart = {
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
    capsule === null ? null : artifactPlacement(capsule.artifact, capsule.updatedAtIso),
    receipt === null ? null : artifactPlacement(receipt.artifact, receipt.completedAtIso),
    lastManualRestart,
  ].filter((run): run is RunPlacement => run !== null);
  return [...runs].sort((a, b) => b.atIso.localeCompare(a.atIso));
}

function artifactPlacement(artifact: RecoveryArtifactV1, atIso: string): RunPlacement | null {
  if (artifact.machineKind !== 'laser') return null;
  // A resumed or painted run's bytes are not the project's own program.
  if (
    artifact.kind === 'exact-execution' &&
    ((artifact.laserResumeChain?.length ?? 0) > 0 ||
      (artifact.laserSecondPassChain?.length ?? 0) > 0)
  ) {
    return null;
  }
  return {
    outputScope: artifact.outputScope,
    ...(artifact.jobOrigin === undefined ? {} : { jobOrigin: artifact.jobOrigin }),
    fingerprint: artifact.fingerprint,
    atIso,
  };
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
