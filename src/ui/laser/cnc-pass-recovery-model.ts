// Pure review model for the pass-boundary CNC recovery wizard (ADR-215):
// which passes exist, what the sealed evidence proves about each, and which
// boundary is preselected. Built ONLY from the sealed capsule plus the live
// work-offset snapshot passed in — never from the open canvas.

import { cncPassEntryDepthMm, cncPassXyPoints, type Group } from '../../core/job';
import { resolveCncResumePoint, type CncResumePoint } from '../../core/recovery/cnc-resume-point';
import type { Vec2 } from '../../core/scene';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import type { RecoveryCapsule } from '../state/recovery';
import { retainedPositionIssue } from './cnc-pass-recovery-review';
import { deriveCncArtifactPassSpans } from './cnc-pass-span-derivation';

export type CncPassRecoveryPassStatus =
  // The sealed acked count proves this pass's lines executed.
  | 'proven-complete'
  // Between the proven frontier and the last possibly-executed line.
  | 'uncertain'
  // Past everything the controller can have received.
  | 'pending'
  // No span sidecar — nothing can be said from transport evidence.
  | 'unknown';

export type CncPassRecoveryPassOption = {
  readonly groupIndex: number;
  readonly passIndex: number;
  readonly label: string;
  readonly status: CncPassRecoveryPassStatus;
  readonly xyPoints: ReadonlyArray<Vec2>;
};

export type CncPassRecoveryModel =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'ready';
      readonly passes: ReadonlyArray<CncPassRecoveryPassOption>;
      readonly resumePoint: CncResumePoint | null;
      readonly defaultSelection: { readonly groupIndex: number; readonly passIndex: number } | null;
      /** Null when the retained-position path is available. */
      readonly retainedPositionIssue: string | null;
    };

/** The sealed-artifact default boundary. Null when spans cannot be derived
 * (the wizard then requires manual pass selection — never a refusal). */
export function cncPassRecoveryDefaultPoint(capsule: RecoveryCapsule): CncResumePoint | null {
  const artifact = capsule.artifact;
  if (artifact.kind !== 'exact-execution' || artifact.machineKind !== 'cnc') return null;
  const spans = deriveCncArtifactPassSpans(artifact);
  if (spans === null) return null;
  return resolveCncResumePoint({
    gcode: artifact.gcode,
    ackedLines: capsule.ackedLines,
    spans,
    controllerKind: artifact.controller.kind,
    streamingMode: artifact.controller.streamingMode,
    rxBufferBytes: artifact.controller.rxBufferBytes,
  });
}

export function buildCncPassRecoveryModel(
  capsule: RecoveryCapsule,
  liveWco: WorkCoordinateOffset | null,
): CncPassRecoveryModel {
  const artifact = capsule.artifact;
  if (artifact.machineKind !== 'cnc') {
    return { kind: 'unavailable', reason: 'The retained checkpoint is not a CNC job.' };
  }
  if (artifact.kind !== 'exact-execution') {
    return {
      kind: 'unavailable',
      reason:
        'This migrated fingerprint-only record has no sealed prepared job. Use the legacy recovery review instead.',
    };
  }
  const resumePoint = cncPassRecoveryDefaultPoint(capsule);
  const spans = deriveCncArtifactPassSpans(artifact);
  const lastPossiblePass =
    resumePoint?.kind === 'resume-at-pass' && spans !== null
      ? passContainingRawLine(spans, resumePoint.lastPossiblyExecutedRawLine)
      : null;
  const passes = collectPassOptions(artifact.prepared.job.groups, resumePoint, lastPossiblePass);
  return {
    kind: 'ready',
    passes,
    resumePoint,
    defaultSelection:
      resumePoint?.kind === 'resume-at-pass'
        ? { groupIndex: resumePoint.groupIndex, passIndex: resumePoint.passIndex }
        : null,
    retainedPositionIssue: retainedPositionIssue(capsule, liveWco),
  };
}

type SpanLike = {
  readonly groupIndex: number;
  readonly passIndex: number;
  readonly firstRawLine: number;
  readonly lastRawLine: number;
};

function passContainingRawLine(
  spans: ReadonlyArray<SpanLike>,
  rawLine: number,
): { readonly groupIndex: number; readonly passIndex: number } | null {
  const containing = spans.find((span) => span.lastRawLine >= rawLine);
  return containing === null || containing === undefined
    ? null
    : { groupIndex: containing.groupIndex, passIndex: containing.passIndex };
}

function collectPassOptions(
  groups: ReadonlyArray<Group>,
  resumePoint: CncResumePoint | null,
  lastPossiblePass: { readonly groupIndex: number; readonly passIndex: number } | null,
): ReadonlyArray<CncPassRecoveryPassOption> {
  const options: CncPassRecoveryPassOption[] = [];
  let operationNumber = 0;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (group?.kind !== 'cnc') continue;
    operationNumber += 1;
    const tool = group.toolName ?? group.toolId;
    for (let passIndex = 0; passIndex < group.passes.length; passIndex += 1) {
      const pass = group.passes[passIndex];
      if (pass === undefined) continue;
      options.push({
        groupIndex,
        passIndex,
        label:
          `Operation ${operationNumber} (${group.cutType}${tool === undefined ? '' : ` · ${tool}`})` +
          ` · pass ${passIndex + 1} of ${group.passes.length}` +
          ` · Z ${cncPassEntryDepthMm(pass).toFixed(3)} mm`,
        status: passStatus({ groupIndex, passIndex }, resumePoint, lastPossiblePass),
        xyPoints: cncPassXyPoints(pass),
      });
    }
  }
  return options;
}

function passStatus(
  pass: { readonly groupIndex: number; readonly passIndex: number },
  resumePoint: CncResumePoint | null,
  lastPossiblePass: { readonly groupIndex: number; readonly passIndex: number } | null,
): CncPassRecoveryPassStatus {
  if (resumePoint === null) return 'unknown';
  if (resumePoint.kind === 'after-last-pass') return 'proven-complete';
  if (resumePoint.kind !== 'resume-at-pass') return 'unknown';
  if (isBefore(pass, resumePoint)) return 'proven-complete';
  if (lastPossiblePass === null) return 'uncertain';
  return isBefore(lastPossiblePass, pass) ? 'pending' : 'uncertain';
}

function isBefore(
  a: { readonly groupIndex: number; readonly passIndex: number },
  b: { readonly groupIndex: number; readonly passIndex: number },
): boolean {
  return a.groupIndex === b.groupIndex ? a.passIndex < b.passIndex : a.groupIndex < b.groupIndex;
}
