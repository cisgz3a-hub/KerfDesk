// Which Web Serial read errors leave the port usable, shared by both serial
// transports (audit connect-1).
//
// The Web Serial spec (https://serial.spec.whatwg.org/, the `readable`
// attribute) errors the readable stream with BufferOverrunError, BreakError,
// FramingError or ParityError when the UART reports a line error, sets
// [[readable]] to null and leaves the port open: the next read of
// `port.readable` returns a fresh stream. Only a disconnected port is fatal
// (NetworkError, [[readFatal]]), and that also fires the port's `disconnect`
// event. Chromium matches (serial_port.cc ReceiveErrorIsFatal is false for
// BREAK, FRAME_ERROR, OVERRUN, BUFFER_OVERFLOW and PARITY_ERROR), and both the
// spec and https://developer.chrome.com/docs/capabilities/serial read through
// an outer `while (port.readable)` loop for exactly this reason.
//
// Treating these errors as a cable yank tore the session down mid-job over one
// burst of spindle or laser-PSU noise on a USB-UART bridge, and closed the
// writer too, so Stop could no longer reach a controller that was still
// running. UnknownError (an unspecified operating-system error) is deliberately
// not recovered: nothing says the port survives it, so it keeps the teardown.

const RECOVERABLE_READ_ERRORS: ReadonlySet<string> = new Set([
  'BreakError',
  'BufferOverrunError',
  'FramingError',
  'ParityError',
]);

/** The line-error name when `error` leaves the port open, otherwise null. */
export function recoverableReadErrorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { readonly name?: unknown }).name;
  return typeof name === 'string' && RECOVERABLE_READ_ERRORS.has(name) ? name : null;
}

// A link that survives a line error delivers bytes again. A port that errors
// every fresh stream before delivering anything is not coming back, and
// re-reading it forever would only spin, so after this many recoveries with no
// byte in between the error is handled as fatal.
export const MAX_READ_RECOVERIES_WITHOUT_DATA = 8;

export type ReadRecoveryBudget = {
  /** Bytes arrived: the link is alive, so the count starts over. */
  readonly received: () => void;
  /** Spends one recovery; false once the budget is exhausted. */
  readonly admit: () => boolean;
};

export function createReadRecoveryBudget(
  limit: number = MAX_READ_RECOVERIES_WITHOUT_DATA,
): ReadRecoveryBudget {
  let withoutData = 0;
  return {
    received: () => {
      withoutData = 0;
    },
    admit: () => {
      withoutData += 1;
      return withoutData <= limit;
    },
  };
}
