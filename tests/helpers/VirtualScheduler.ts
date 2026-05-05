/**
 * T2-49: virtual-time scheduler for tests. Pre-T2-49, time-sensitive
 * tests (status polling cadence, character-counting flow control,
 * deadman timers, reconnect retry intervals, ack-rate health) relied
 * on real `setTimeout` + arbitrary flush delays — slow, flaky, and
 * imprecise about event order under races. Audit 3E Required P1.
 *
 * The shape mirrors `setTimeout` / `setInterval` / `clearTimeout` so
 * any production code that takes a `SchedulerLike` injection can be
 * tested with virtual time. Real timers in production, virtual in
 * tests.
 *
 * Lives under `tests/helpers/` (T2-22 EXCLUDED_DIRS sentinel) so
 * auto-discovery does not try to run this as a test file.
 */

export interface TimerHandle {
  readonly id: number;
}

export interface SchedulerLike {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  clearInterval(handle: TimerHandle): void;
  /** Wall-clock-equivalent in ms; for virtual schedulers this is the simulated time. */
  readonly now: number;
}

interface ScheduledTask {
  id: number;
  /** Absolute virtual time at which to fire next. */
  fireAt: number;
  /** When defined, recurring at this interval after each fire. */
  intervalMs: number | null;
  fn: () => void;
  cancelled: boolean;
}

/**
 * Deterministic scheduler. `advanceBy(ms)` runs every task whose
 * `fireAt` is at or before the new time; `advanceUntilIdle()` keeps
 * draining until the queue is empty.
 *
 * Ordering rule: ties on `fireAt` break by enqueue order. Tasks that
 * schedule new tasks during their callback are added to the queue
 * and may fire within the same `advanceBy` call if their `fireAt`
 * falls within the same advance window.
 */
export class VirtualScheduler implements SchedulerLike {
  private _now = 0;
  private _nextId = 1;
  private _queue: ScheduledTask[] = [];

  get now(): number {
    return this._now;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    return this._enqueue(fn, ms, null);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    return this._enqueue(fn, ms, ms);
  }

  clearTimeout(handle: TimerHandle): void {
    this._cancel(handle.id);
  }

  clearInterval(handle: TimerHandle): void {
    this._cancel(handle.id);
  }

  /**
   * Advance virtual time by `ms`. Fires any task whose `fireAt` is
   * at or before the new time; recurring tasks are re-queued with
   * `fireAt += intervalMs` after each fire. Throws if `ms < 0`.
   */
  advanceBy(ms: number): void {
    if (ms < 0) throw new Error('advanceBy: ms must be ≥ 0');
    const target = this._now + ms;
    while (true) {
      const next = this._peekDue(target);
      if (!next) break;
      this._removeById(next.id);
      this._now = next.fireAt;
      if (!next.cancelled) {
        try { next.fn(); } catch (e) { /* test scaffold — surface */ throw e; }
        if (next.intervalMs != null && !next.cancelled) {
          // Recurring: re-enqueue at fireAt + interval. Do NOT compound
          // missed intervals — if the fn is slow, only the next fire
          // is rescheduled (matches setInterval semantics).
          this._queue.push({
            ...next,
            fireAt: next.fireAt + next.intervalMs,
            cancelled: false,
          });
        }
      }
    }
    this._now = target;
  }

  /**
   * Drain the queue. Useful when "run until everything settles" is
   * what the test wants. Throws if a runaway recursive scheduler
   * pushes more tasks than `safetyLimit` (default 100 000) — that's
   * almost always an unintended infinite loop in the code under test.
   */
  advanceUntilIdle(safetyLimit = 100_000): void {
    let n = 0;
    while (this._queue.length > 0) {
      n += 1;
      if (n > safetyLimit) {
        throw new Error(`advanceUntilIdle: exceeded safety limit ${safetyLimit} — likely infinite loop`);
      }
      // Find the earliest due task; ties break by enqueue order.
      const next = this._peekEarliest();
      if (!next) break;
      this._removeById(next.id);
      this._now = next.fireAt;
      if (!next.cancelled) {
        next.fn();
        if (next.intervalMs != null && !next.cancelled) {
          this._queue.push({
            ...next,
            fireAt: next.fireAt + next.intervalMs,
            cancelled: false,
          });
        }
      }
    }
  }

  /** Test introspection — number of pending tasks. */
  get pendingCount(): number {
    return this._queue.filter((t) => !t.cancelled).length;
  }

  // ─── internals ─────────────────────────────────────────────

  private _enqueue(fn: () => void, ms: number, intervalMs: number | null): TimerHandle {
    if (ms < 0) throw new Error('setTimeout/setInterval: ms must be ≥ 0');
    const id = this._nextId++;
    this._queue.push({
      id,
      fireAt: this._now + ms,
      intervalMs,
      fn,
      cancelled: false,
    });
    return { id };
  }

  private _cancel(id: number): void {
    const t = this._queue.find((x) => x.id === id);
    if (t) t.cancelled = true;
  }

  private _removeById(id: number): void {
    const i = this._queue.findIndex((x) => x.id === id);
    if (i >= 0) this._queue.splice(i, 1);
  }

  private _peekDue(target: number): ScheduledTask | null {
    let earliest: ScheduledTask | null = null;
    for (const t of this._queue) {
      if (t.cancelled) continue;
      if (t.fireAt > target) continue;
      if (!earliest || t.fireAt < earliest.fireAt) earliest = t;
    }
    return earliest;
  }

  private _peekEarliest(): ScheduledTask | null {
    let earliest: ScheduledTask | null = null;
    for (const t of this._queue) {
      if (t.cancelled) continue;
      if (!earliest || t.fireAt < earliest.fireAt) earliest = t;
    }
    return earliest;
  }
}

/**
 * Real-timer adapter — production default. Wraps the host's
 * setTimeout / setInterval to satisfy the same `SchedulerLike`
 * surface as `VirtualScheduler` so the dependency injection point
 * is uniform.
 */
export class RealScheduler implements SchedulerLike {
  get now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = setTimeout(fn, ms) as unknown as number;
    return { id };
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = setInterval(fn, ms) as unknown as number;
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    clearTimeout(handle.id as unknown as ReturnType<typeof setTimeout>);
  }

  clearInterval(handle: TimerHandle): void {
    clearInterval(handle.id as unknown as ReturnType<typeof setInterval>);
  }
}
