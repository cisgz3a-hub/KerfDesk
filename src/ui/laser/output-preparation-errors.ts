export const BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE =
  'Background compilation is unavailable. Reopen CurveDesk or enable worker support, then try again.';

export const BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE =
  'Background output preparation queue is full. Wait for the current compilation to finish, then try again.';

export type OutputPreparationFailureKind = 'capacity' | 'infrastructure' | 'compilation';

/** A request rejection is distinct from loss of the shared worker. */
export class OutputPreparationError extends Error {
  constructor(
    readonly kind: OutputPreparationFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'OutputPreparationError';
  }
}

export function isOutputPreparationAbort(error: unknown): boolean {
  return isNamedOutputPreparationError(error, 'AbortError');
}

export function isNamedOutputPreparationError(
  error: unknown,
  name: string,
): error is { readonly name: string; readonly message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === name &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

export function outputPreparationFailure(error: unknown): {
  readonly kind: OutputPreparationFailureKind;
  readonly message: string;
} {
  if (error instanceof OutputPreparationError) return error;
  // Unexpected request/compiler failures retain their diagnosis. They are
  // not evidence that the browser lacks Worker infrastructure.
  return {
    kind: 'compilation',
    message:
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
        ? error.message
        : String(error),
  };
}
