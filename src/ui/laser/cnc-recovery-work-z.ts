// Which Z zero a CNC recovery would cut on, and for which bit (CNC audit v3
// N5-P1-1, ADR-215 Amendment 3, extending ADR-215 Amendment 2's H3-P1-1 check).
//
// The recovery start-bit check compared the recovery program's first bit with
// the live Work Z record, and passed when there was none. An Abort is a reset,
// and every reset voids that record, so after an Abort the check never ran:
// - at a bit-change hold zeroed with Zero Z, stock GRBL and FluidNC cleared
//   the hold's G92 at the reset, the work offset fell back to the one archived
//   at Start, and "Position retained" passed, so the previous bit's passes, or
//   the new bit's, ran at the previous bit's zero;
// - at a hold zeroed by the probe, the "re-zeroed" path ran the previous bit's
//   passes with the new bit.
//
// Recovery now reads the record the reset voided (work-z-before-reset.ts):
// - a zero the controller kept (a work offset, or grblHAL's G92) is checked
//   against the recovery's first bit like a live record;
// - a G92 the reset cleared refuses both paths until Z is zeroed again;
// - no record at all, once the run had reached a bit change, refuses too: the
//   bit in the spindle and its zero are unknown. Before any bit change the
//   no-work-zero warning still covers it, as before.

import type { Job } from '../../core/job';
import { isToolChangeLine } from '../../core/controllers/grbl/streamer';
import { isSendableGcodeLine } from '../../core/controllers/grbl';
import type { Project } from '../../core/scene';
import { cncToolPlan, type CncToolPlanEntry } from '../state/cnc-tool-plan';
import type { RecoveryCapsule } from '../state/recovery';
import { SPINDLE_BIT_LABEL, spindleBitOf, type SpindleBitState } from '../state/spindle-bit';
import {
  currentWorkZBeforeReset,
  type WorkZBeforeReset,
  type WorkZBeforeResetState,
} from '../state/work-z-before-reset';
import type { WorkZZeroEvidence } from '../state/work-z-zero-evidence';

export type CncRecoveryWorkZ =
  | { readonly kind: 'recorded'; readonly evidence: WorkZZeroEvidence }
  | { readonly kind: 'kept-after-reset'; readonly record: WorkZBeforeReset }
  | { readonly kind: 'cleared-by-reset'; readonly record: WorkZBeforeReset }
  | { readonly kind: 'unrecorded'; readonly afterBitChange: boolean };

export type CncRecoveryWorkZSource = WorkZBeforeResetState & {
  readonly workZZeroEvidence: WorkZZeroEvidence | null;
  readonly workZReferenceEpoch: number;
};

export function cncRecoveryWorkZ(
  laser: CncRecoveryWorkZSource,
  capsule: RecoveryCapsule,
): CncRecoveryWorkZ {
  if (laser.workZZeroEvidence !== null) {
    return { kind: 'recorded', evidence: laser.workZZeroEvidence };
  }
  const record = currentWorkZBeforeReset(laser);
  if (record !== null) {
    return record.g92Cleared
      ? { kind: 'cleared-by-reset', record }
      : { kind: 'kept-after-reset', record };
  }
  return { kind: 'unrecorded', afterBitChange: runReachedBitChange(capsule) };
}

/** The Work Z record the start-bit check compares with: the live one, or one
 * the controller kept through the reset. */
export function cncRecoveryWorkZEvidence(workZ: CncRecoveryWorkZ): WorkZZeroEvidence | null {
  if (workZ.kind === 'recorded') return workZ.evidence;
  return workZ.kind === 'kept-after-reset' ? workZ.record.evidence : null;
}

/** Why recovery may not stream on this Z zero whichever position path the
 * operator chose, or null. A bit mismatch is the start-bit check's. */
export function cncRecoveryWorkZIssue(
  project: Project,
  recoveryJob: Job,
  workZ: CncRecoveryWorkZ,
): string | null {
  const firstBit = bitName(project, cncToolPlan(recoveryJob)[0]);
  if (workZ.kind === 'cleared-by-reset') {
    return (
      `The controller reset when the job stopped, and the reset cleared the Zero Z (G92) set for ` +
      `${evidenceBitName(project, workZ.record.evidence)}. Its Z zero is back to the one from ` +
      `before that bit was zeroed. ${zeroAgain(firstBit)}`
    );
  }
  if (workZ.kind === 'unrecorded' && workZ.afterBitChange) {
    return (
      'The job had reached a bit change, and no Z zero is on record for the bit in the spindle ' +
      `since the controller reset. ${zeroAgain(firstBit)}`
    );
  }
  return null;
}

/** Why "Position retained" cannot stand for this Z zero, or null. */
export function cncRetainedWorkZIssue(project: Project, workZ: CncRecoveryWorkZ): string | null {
  if (workZ.kind === 'cleared-by-reset') {
    return (
      `The controller reset when the job stopped, and the reset cleared the Zero Z (G92) set for ` +
      `${evidenceBitName(project, workZ.record.evidence)}, so the work offset now matches the run's ` +
      'start only because that zero is gone. Zero Z again with the bit in the spindle, then choose ' +
      'the re-zeroed option.'
    );
  }
  if (workZ.kind === 'unrecorded' && workZ.afterBitChange) {
    return (
      'The job had reached a bit change, and no Z zero is on record for the bit in the spindle, ' +
      'so the work offset archived at the start may belong to another bit. Zero Z or probe with ' +
      'the bit in the spindle, then choose the re-zeroed option.'
    );
  }
  return null;
}

/** cncRetainedWorkZIssue for the live store, naming bits as the sealed job
 * named them (the open project's list where the record has no sealed job). */
export function liveCncRetainedWorkZIssue(
  laser: CncRecoveryWorkZSource,
  capsule: RecoveryCapsule,
  openProject: Project,
): string | null {
  const project =
    capsule.artifact.kind === 'exact-execution' ? capsule.artifact.prepared.project : openProject;
  return cncRetainedWorkZIssue(project, cncRecoveryWorkZ(laser, capsule));
}

/** Lines for the recovery confirmation naming the bits and the zero. */
export function cncRecoveryBitLines(
  project: Project,
  recoveryJob: Job,
  workZ: CncRecoveryWorkZ,
  laser: SpindleBitState,
): ReadonlyArray<string> {
  const declared = spindleBitOf(laser, project);
  return [
    `Recovery starts with: ${bitName(project, cncToolPlan(recoveryJob)[0])}`,
    `${SPINDLE_BIT_LABEL}: ${declared === null ? 'not declared' : declared.name}`,
    `Z zero on record: ${zeroOnRecord(project, workZ)}`,
  ];
}

/** The specific note that replaces the generic no-work-zero warning when the
 * controller kept the zero the reset voided; null otherwise. */
export function cncKeptWorkZNote(project: Project, workZ: CncRecoveryWorkZ): string | null {
  if (workZ.kind !== 'kept-after-reset') return null;
  return (
    "The controller reset when the job stopped, which voids KerfDesk's Work Z record. The " +
    `controller kept the Z zero set by ${zeroMethod(workZ.record.evidence)} for ` +
    `${evidenceBitName(project, workZ.record.evidence)} through it, and this recovery cuts on that zero.`
  );
}

function zeroOnRecord(project: Project, workZ: CncRecoveryWorkZ): string {
  switch (workZ.kind) {
    case 'recorded':
      return `${evidenceBitName(project, workZ.evidence)}, set by ${zeroMethod(workZ.evidence)}`;
    case 'kept-after-reset':
      return (
        `${evidenceBitName(project, workZ.record.evidence)}, set by ` +
        `${zeroMethod(workZ.record.evidence)} and kept through the controller reset`
      );
    case 'cleared-by-reset':
      return 'none: the controller reset cleared it';
    case 'unrecorded':
      return 'none since the controller reset';
  }
}

function zeroMethod(evidence: WorkZZeroEvidence): string {
  if (evidence.source === 'manual-zero') return 'Zero Z (G92)';
  return evidence.source === 'probe' ? 'the touch-plate probe' : 'the controller read-back';
}

function zeroAgain(firstBit: string): string {
  return (
    `Load ${firstBit}, choose it under ${SPINDLE_BIT_LABEL} in the Machine rail, then touch it ` +
    'to the stock top and Zero Z, or probe, before starting recovery.'
  );
}

function bitName(project: Project, entry: CncToolPlanEntry | undefined): string {
  if (entry === undefined) return 'the first bit';
  return entry.name ?? toolName(project, entry.id) ?? 'an unnamed bit';
}

function evidenceBitName(project: Project, evidence: WorkZZeroEvidence): string {
  return toolName(project, evidence.toolId ?? null) ?? 'an unrecorded bit';
}

function toolName(project: Project, toolId: string | null): string | null {
  if (toolId === null) return null;
  const tools = project.machine?.kind === 'cnc' ? project.machine.tools : [];
  return tools.find((tool) => tool.id === toolId)?.name ?? toolId;
}

// The stream holds in front of a tool-change M0 without sending it, so the
// line after the acknowledged ones counts: the run was then at the hold.
function runReachedBitChange(capsule: RecoveryCapsule): boolean {
  if (capsule.artifact.kind !== 'exact-execution') return false;
  let sendable = 0;
  for (const line of capsule.artifact.gcode.split('\n')) {
    if (!isSendableGcodeLine(line)) continue;
    sendable += 1;
    if (sendable > capsule.ackedLines + 1) return false;
    if (isToolChangeLine(line)) return true;
  }
  return false;
}
