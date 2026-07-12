export type JobInterruptionKind =
  | 'disconnect'
  | 'controller-error'
  | 'write-failed'
  | 'controller-reboot'
  | 'stream-stalled'
  | 'cancelled'
  | 'unknown';

export type JobInterruption = {
  readonly kind: JobInterruptionKind;
  readonly message: string;
  readonly rejectedLine?: string;
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
  return {
    interruption: {
      kind,
      message,
      ...(rejectedLine === undefined ? {} : { rejectedLine }),
    },
  };
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
