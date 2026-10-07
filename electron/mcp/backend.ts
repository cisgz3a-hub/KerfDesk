/** The desktop bridge owns revision, Undo, request deduplication and licence admission. */
export interface KerfDeskMcpBackend {
  request(
    command: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    /** Actual JSON-RPC ID, distinct from the command's durable UUID requestId. */
    wireRequestId?: string | number,
  ): Promise<Record<string, unknown>>;
}

export const mcpErrorMessages = {
  unavailable: 'The desktop workspace is not available. Open KerfDesk and try again.',
  stale_revision: 'The workspace changed. Read its current revision before retrying.',
  needs_pro: 'This change requires Pro access in the desktop app.',
  unsupported_operation: 'This tool cannot edit that operation.',
  invalid_input: 'The tool arguments are invalid.',
  cancelled: 'The request was cancelled.',
  control_limit:
    'No machine action was dispatched. This approval has reached its action limit. Create a new pairing and approve machine control on the PC.',
  failed: 'The desktop request could not be completed.',
} as const;

export type KerfDeskMcpErrorCode = keyof typeof mcpErrorMessages;

/** Only this code crosses the MCP boundary; arbitrary backend messages never do. */
export class KerfDeskMcpError extends Error {
  constructor(readonly code: KerfDeskMcpErrorCode) {
    super(mcpErrorMessages[code]);
    this.name = 'KerfDeskMcpError';
  }
}

export function mcpErrorCode(error: unknown): KerfDeskMcpErrorCode {
  try {
    if (typeof error !== 'object' || error === null || !('code' in error)) return 'failed';
    const code: unknown = error.code;
    if (typeof code === 'string' && Object.hasOwn(mcpErrorMessages, code)) {
      return code as KerfDeskMcpErrorCode;
    }
  } catch {
    // Even an untrusted exception getter must not reach the protocol's raw-error fallback.
  }
  return 'failed';
}

/** Stop waiting on cancelled work even when a backend fails to honour its signal. */
export function requestMcpBackend(
  backend: KerfDeskMcpBackend,
  command: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  wireRequestId?: string | number,
): Promise<Record<string, unknown>> {
  if (signal.aborted) return Promise.reject(new KerfDeskMcpError('cancelled'));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new KerfDeskMcpError('cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new KerfDeskMcpError('cancelled');
        return backend.request(command, args, signal, wireRequestId);
      })
      .then(
        (value) => {
          signal.removeEventListener('abort', cancel);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', cancel);
          reject(new KerfDeskMcpError(mcpErrorCode(error)));
        },
      );
  });
}
