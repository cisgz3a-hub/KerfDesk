import { activeCncTool, type Project } from '../../core/scene';

export type WorkZZeroEvidenceSource = 'manual-zero' | 'probe';

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
};

export function captureWorkZZeroEvidence(
  source: WorkZZeroEvidenceSource,
  referenceEpoch: number | undefined,
  toolId?: string,
): WorkZZeroEvidence {
  return {
    source,
    referenceEpoch: referenceEpoch ?? 0,
    ...(toolId === undefined ? {} : { toolId }),
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
