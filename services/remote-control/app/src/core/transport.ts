/** One interface for the phone (cookie session + socket) and MCP Apps hosts (host bridge). */
export type LiveEvent =
  | { type: 'changed'; revision: string; machineSeq: number }
  | { type: 'presence'; online: boolean }
  | { type: 'event'; kind: 'job.finished' | 'job.stopped' | 'machine.alarm' }
  | { type: 'socket'; open: boolean };

export interface RemoteTransport {
  readonly kind: 'phone' | 'mcp';
  call<T = Record<string, unknown>>(
    command: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  /** Push channel when available. MCP hosts have none; the app long-polls `wait_for_change`. */
  subscribe(listener: (event: LiveEvent) => void): () => void;
  /** True only while a live phone socket is open (held jogs require it). */
  socketOpen(): boolean;
  heartbeat(operationId: string): void;
  releaseHolds(): void;
}

export const ERROR_TEXT: Record<string, string> = {
  stale_revision: 'The design changed on the PC. Your view was refreshed — try again.',
  needs_pro: 'This needs Pro. Start a trial or add a licence on the PC.',
  unsupported_operation: 'That isn’t supported for this artwork or operation.',
  invalid_input: 'That value isn’t accepted. Check it and try again.',
  cancelled: 'The request was cancelled.',
  unavailable: 'The PC can’t do that right now. Check KerfDesk on the computer.',
  control_limit: 'This phone has used all its machine actions. Pair again on the PC.',
  forbidden: 'This connection isn’t approved for that. Change access on the PC.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  offline: 'The PC is offline. Keep KerfDesk open and the computer awake.',
  failed: 'That didn’t work. Check KerfDesk on the PC.',
};

export class RemoteError extends Error {
  constructor(
    readonly code: string,
    message = ERROR_TEXT[code] ?? ERROR_TEXT.failed,
    /** The request may have reached the PC; keep its ID and check status before retrying. */
    readonly ambiguous = false,
  ) {
    super(message);
  }
}

export function uuid(): string {
  return crypto.randomUUID();
}
