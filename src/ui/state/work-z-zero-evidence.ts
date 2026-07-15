import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import { activeCncTool, type Project } from '../../core/scene';

export type WorkZZeroEvidenceSource = 'manual-zero' | 'probe' | 'controller-readback';

export const PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE =
  'Remove the touch plate and probe lead from the stock and cutter, then click ' +
  '"Confirm plate removed" in the probe panel. Do not press Zero Z with the bit parked in ' +
  'the air — that discards the probed work zero.';

/**
 * Session-scoped proof that the active bit was referenced to the stock-top Z0.
 *
 * The reference epoch changes whenever machine position/reference truth becomes
 * unknown. Keeping the epoch inside the evidence makes stale records fail closed
 * even if a future invalidation path forgets to clear the store field directly.
 */
export type WorkZZeroEvidence = {
  readonly source: WorkZZeroEvidenceSource;
  readonly referenceEpoch: number;
  /** Cutter selected as physically loaded when the Z reference began. */
  readonly toolId?: string;
  /** Probe plates are a collision hazard until the operator removes them. */
  readonly probePlateRemoved?: boolean;
  readonly controllerSessionEpoch?: number;
  readonly activeWcs?: ActiveWorkCoordinateSystem;
  readonly offsetZMm?: number;
  readonly observedAtMs?: number;
};

export function captureWorkZZeroEvidence(
  source: Exclude<WorkZZeroEvidenceSource, 'controller-readback'>,
  referenceEpoch: number | undefined,
  toolId?: string,
): WorkZZeroEvidence {
  return {
    source,
    referenceEpoch: referenceEpoch ?? 0,
    ...(toolId === undefined ? {} : { toolId }),
    ...(source === 'probe' ? { probePlateRemoved: false } : {}),
  };
}

export function captureControllerWorkZEvidence(input: {
  readonly referenceEpoch: number;
  readonly controllerSessionEpoch: number;
  readonly toolId: string;
  readonly activeWcs: ActiveWorkCoordinateSystem;
  readonly offsetZMm: number;
  readonly observedAtMs: number;
}): WorkZZeroEvidence {
  return {
    source: 'controller-readback',
    referenceEpoch: input.referenceEpoch,
    controllerSessionEpoch: input.controllerSessionEpoch,
    toolId: input.toolId,
    activeWcs: input.activeWcs,
    offsetZMm: input.offsetZMm,
    observedAtMs: input.observedAtMs,
  };
}

export function selectedCncToolId(project: Pick<Project, 'machine'>): string | undefined {
  const machine = project.machine;
  return machine?.kind === 'cnc' ? activeCncTool(machine).id : undefined;
}

export function isWorkZZeroEvidenceCurrent(
  evidence: WorkZZeroEvidence | null | undefined,
  referenceEpoch: number | undefined,
): boolean {
  return (
    evidence !== null && evidence !== undefined && evidence.referenceEpoch === (referenceEpoch ?? 0)
  );
}

export function isWorkZEvidenceCurrentForStart(
  evidence: WorkZZeroEvidence | null | undefined,
  referenceEpoch: number | undefined,
  controllerSessionEpoch: number | undefined,
): boolean {
  if (!isWorkZZeroEvidenceCurrent(evidence, referenceEpoch)) return false;
  if (evidence?.source !== 'controller-readback') return true;
  return evidence.controllerSessionEpoch === controllerSessionEpoch;
}

export function probePlateRemovalRequired(evidence: WorkZZeroEvidence | null | undefined): boolean {
  return evidence?.source === 'probe' && evidence.probePlateRemoved !== true;
}
