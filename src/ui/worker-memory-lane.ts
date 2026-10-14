type Reservation = {
  start: ((release: () => void) => void) | null;
  readonly options: WorkerMemoryReservationOptions;
  preemptRequested: boolean;
  closed: boolean;
};

export type WorkerMemoryReservationOptions = {
  readonly priority?: 'background' | 'interactive';
  /** Retire the heap before releasing; the owner may then requeue useful work. */
  readonly onPreempt?: () => void;
};

/** Serializes worker heaps that share the browser's finite V8 address cage. */
export class WorkerMemoryLane {
  private readonly queued: Reservation[] = [];
  private active: Reservation | null = null;
  private draining = false;

  /**
   * Grant synchronously when free, otherwise FIFO within priority. The returned cancel and
   * granted release share one idempotent token. Dispose an active worker
   * before releasing it. Callers settle their own startup errors.
   */
  reserve(
    start: (release: () => void) => void,
    options: WorkerMemoryReservationOptions = {},
  ): () => void {
    const reservation: Reservation = { start, options, preemptRequested: false, closed: false };
    const release = (): void => this.release(reservation);
    this.queued.push(reservation);
    this.drain();
    this.preemptForInteractiveWork();
    return release;
  }

  private release(reservation: Reservation): void {
    if (reservation.closed) return;
    reservation.closed = true;
    reservation.start = null;
    if (this.active === reservation) this.active = null;
    else {
      const index = this.queued.indexOf(reservation);
      if (index >= 0) this.queued.splice(index, 1);
    }
    this.drain();
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active === null && this.queued.length > 0) {
        const interactive = this.queued.findIndex(
          (candidate) => candidate.options.priority === 'interactive',
        );
        const [reservation] = this.queued.splice(Math.max(0, interactive), 1);
        if (reservation === undefined || reservation.closed) continue;
        this.active = reservation;
        const start = reservation.start;
        reservation.start = null;
        try {
          start?.(() => this.release(reservation));
        } catch (error) {
          this.release(reservation);
          throw error;
        }
      }
    } finally {
      this.draining = false;
      if (this.active === null && this.queued.length > 0) this.drain();
      this.preemptForInteractiveWork();
    }
  }

  private preemptForInteractiveWork(): void {
    const active = this.active;
    // A reentrant reservation must not interrupt a start callback halfway
    // through construction. The outer drain checks again after it returns.
    if (
      this.draining ||
      active === null ||
      active.preemptRequested ||
      active.options.priority === 'interactive' ||
      active.options.onPreempt === undefined ||
      !this.queued.some((candidate) => candidate.options.priority === 'interactive')
    )
      return;
    active.preemptRequested = true;
    active.options.onPreempt();
  }
}

const workerMemoryLane = new WorkerMemoryLane();

/** One main-realm lane shared by output-derived preparation and autosave. */
export function reserveWorkerMemory(
  start: (release: () => void) => void,
  options: WorkerMemoryReservationOptions = {},
): () => void {
  return workerMemoryLane.reserve(start, options);
}
