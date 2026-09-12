type Reservation = {
  start: ((release: () => void) => void) | null;
  closed: boolean;
};

/** Serializes worker heaps that share the browser's finite V8 address cage. */
export class WorkerMemoryLane {
  private readonly queued: Reservation[] = [];
  private active: Reservation | null = null;
  private draining = false;

  /**
   * Grant synchronously when free, otherwise FIFO. The returned cancel and
   * granted release share one idempotent token. Dispose an active worker
   * before releasing it. Callers settle their own startup errors.
   */
  reserve(start: (release: () => void) => void): () => void {
    const reservation: Reservation = { start, closed: false };
    const release = (): void => this.release(reservation);
    this.queued.push(reservation);
    this.drain();
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
        const reservation = this.queued.shift();
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
    }
  }
}

const workerMemoryLane = new WorkerMemoryLane();

/** One main-realm lane shared by output-derived preparation and autosave. */
export function reserveWorkerMemory(start: (release: () => void) => void): () => void {
  return workerMemoryLane.reserve(start);
}
