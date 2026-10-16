/** A Focus operation whose relative Z semantics cannot be compiled faithfully. */
export class FocusTestCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FocusTestCompilationError';
  }
}
