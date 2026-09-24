export type JobInterruptionKind =
  | 'disconnect'
  | 'controller-error'
  | 'write-failed'
  | 'controller-reboot'
  | 'stream-stalled'
  | 'cancelled'
  | 'unknown';

/**
 * The controller's planner backlog at its last status report before a stop
 * that discards the planner (Abort, an auto-abort after a rejected line, a
 * reboot): how many lines were acknowledged then, and how many planner blocks
 * were still waiting to move. An acknowledgement means "parsed", not
 * "moved", so this bounds how far the automatic restart must step back.
 */
export type PlannerBacklog = {
  readonly ackedAtStatus: number;
  readonly queuedBlocks: number;
};

export type JobInterruption = {
  readonly kind: JobInterruptionKind;
  readonly message: string;
  readonly rejectedLine?: string;
  readonly plannerBacklog?: PlannerBacklog;
};

export function withJobInterruption<T extends { readonly updatedAtIso: string }>(
  checkpoint: T,
  interruption: JobInterruption,
  nowIso: string,
): T & { readonly interruption: JobInterruption } {
  return { ...checkpoint, interruption, updatedAtIso: nowIso };
}

export function parseOptionalJobInterruption(
  value: unknown,
): { readonly interruption?: JobInterruption } | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const kind = value['kind'];
  const message = value['message'];
  const rejectedLine = value['rejectedLine'];
  if (!isJobInterruptionKind(kind) || typeof message !== 'string') return null;
  if (rejectedLine !== undefined && typeof rejectedLine !== 'string') return null;
  const plannerBacklog = parsePlannerBacklog(value['plannerBacklog']);
  if (plannerBacklog === null) return null;
  return {
    interruption: {
      kind,
      message,
      ...(rejectedLine === undefined ? {} : { rejectedLine }),
      ...(plannerBacklog === undefined ? {} : { plannerBacklog }),
    },
  };
}

function parsePlannerBacklog(value: unknown): PlannerBacklog | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const ackedAtStatus = value['ackedAtStatus'];
  const queuedBlocks = value['queuedBlocks'];
  if (!isNonNegativeInteger(ackedAtStatus) || !isNonNegativeInteger(queuedBlocks)) return null;
  return { ackedAtStatus, queuedBlocks };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isJobInterruptionKind(value: unknown): value is JobInterruptionKind {
  return (
    typeof value === 'string' &&
    [
      'disconnect',
      'controller-error',
      'write-failed',
      'controller-reboot',
      'stream-stalled',
      'cancelled',
      'unknown',
    ].includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
