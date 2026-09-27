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
 *
 * Zero queued blocks is a frontier too: the planner was empty at that report,
 * so every line acknowledged by then had run and only later ones may not have.
 * When no status report showed the backlog (stock GRBL and FluidNC print no
 * `Bf` at `$10=1`; Smoothieware never does), `bound: 'planner-size'` records
 * the controller's whole planner at the acknowledgement count of the stop
 * (controller audit OR-3).
 */
export type PlannerBacklog = {
  readonly ackedAtStatus: number;
  readonly queuedBlocks: number;
  readonly bound?: 'planner-size';
};

export type JobInterruption = {
  readonly kind: JobInterruptionKind;
  readonly message: string;
  readonly rejectedLine?: string;
  readonly plannerBacklog?: PlannerBacklog;
  /**
   * The stop may have killed the steppers mid-motion: a soft reset (Abort)
   * while the machine was moving, or an alarm GRBL documents as losing
   * position (a hard limit, ALARM:3). The controller cannot know about steps
   * it never took, so its work offset still reads as unchanged; recovery must
   * not offer the retained-position path (ADR-215 Amendment 1, CNC audit MC-3).
   */
  readonly positionLost?: true;
  /**
   * Lines sent before a lost link: acknowledged ones plus those still in
   * flight, in sendable numbering. A dropped link leaves the controller
   * running what it had received, so the head stops at the end of the last of
   * these (ADR-341 Amendment 6).
   */
  readonly sentLines?: number;
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
  const evidence = parseStopEvidence(value);
  if (evidence === null) return null;
  return {
    interruption: {
      kind,
      message,
      ...(rejectedLine === undefined ? {} : { rejectedLine }),
      ...evidence,
    },
  };
}

/** The optional facts about where the stop left the machine; null when one is corrupt. */
function parseStopEvidence(
  value: Record<string, unknown>,
): Pick<JobInterruption, 'plannerBacklog' | 'positionLost' | 'sentLines'> | null {
  const positionLost = parsePositionLost(value['positionLost']);
  const plannerBacklog = parsePlannerBacklog(value['plannerBacklog']);
  const sentLines = parseSentLines(value['sentLines']);
  if (positionLost === null || plannerBacklog === null || sentLines === null) return null;
  return {
    ...(plannerBacklog === undefined ? {} : { plannerBacklog }),
    ...(positionLost === undefined ? {} : { positionLost }),
    ...(sentLines === undefined ? {} : { sentLines }),
  };
}

function parsePositionLost(value: unknown): true | undefined | null {
  return value === undefined || value === true ? value : null;
}

function parseSentLines(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return isNonNegativeInteger(value) ? value : null;
}

function parsePlannerBacklog(value: unknown): PlannerBacklog | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const ackedAtStatus = value['ackedAtStatus'];
  const queuedBlocks = value['queuedBlocks'];
  const bound = value['bound'];
  if (!isNonNegativeInteger(ackedAtStatus) || !isNonNegativeInteger(queuedBlocks)) return null;
  if (bound !== undefined && bound !== 'planner-size') return null;
  return { ackedAtStatus, queuedBlocks, ...(bound === undefined ? {} : { bound }) };
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
