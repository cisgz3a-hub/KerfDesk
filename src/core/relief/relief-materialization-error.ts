export class ReliefMaterializationError extends Error {
  override readonly name = 'ReliefMaterializationError';

  constructor(
    readonly source: string,
    readonly reason: string,
  ) {
    super(`Relief "${source}" could not be materialized: ${reason}`);
  }
}

export function isReliefMaterializationError(error: unknown): error is ReliefMaterializationError {
  return error instanceof ReliefMaterializationError;
}
