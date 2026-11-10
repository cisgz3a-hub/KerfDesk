// Turning a caught value into text or into an Error.
//
// A `catch` hands over `unknown`. These two lines were written out again in
// about forty files (code quality audit C1, C2-P3-1). Every copy replaced by
// an import had this exact body.

/** The error's message, or the value as text when it is not an Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The value itself when it is an Error, otherwise an Error holding it as text. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The error's message when it has one; otherwise the fallback text. */
export function errorMessageOr(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}

/** True for the error an aborted fetch, worker task or `AbortSignal` throws. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
