/** A trial's process-local time cannot move backwards or outlive elapsed time. */
export class TrialSessionClock {
  private readonly startedAt: number;
  private readonly startedElapsedMs = performance.now();
  private observedAt: number;

  constructor(
    readonly expiresAt: number,
    private readonly wallNow: () => number,
  ) {
    this.startedAt = wallNow();
    this.observedAt = this.startedAt;
  }

  readonly now = (): number => {
    this.observedAt = Math.max(
      this.observedAt,
      this.wallNow(),
      this.startedAt + Math.max(0, performance.now() - this.startedElapsedMs) / 1000,
    );
    return this.observedAt;
  };
}
