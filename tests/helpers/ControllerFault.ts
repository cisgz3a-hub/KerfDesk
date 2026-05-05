/**
 * T2-50: typed `ControllerFault` model + `FaultQueue` dispatcher.
 * Pre-T2-50 the test surface had T2-13's `FaultInjectingSerialPort`
 * (transport-level) and ad-hoc `MockSerialPort` tools (simulate
 * Disconnect, simulateError, injectResponse, blockStatusQueryResponse)
 * — narrow, ad-hoc, and not discoverable from the type system.
 *
 * Audit 3E Critical 6 + Required P0 calls for a failure-scenario
 * engine where every supported fault is enumerated in a discriminated
 * union, each fault carries its trigger, and the simulator consumes
 * faults declaratively. T2-50 ships the type + the queue dispatcher;
 * wiring the queue into the controller-level simulator is filed as
 * T2-50-followup since it pairs with T2-47 (GrblSimulator).
 *
 * Lives under `tests/helpers/` (T2-22 EXCLUDED_DIRS sentinel) so
 * auto-discovery does not run this as a test file.
 */

/**
 * The fault catalog. Each variant captures one realistic failure
 * mode the simulator can inject deterministically. Triggers are
 * EXPLICIT — no fault fires without one of `afterLine` / `afterCommand`
 * / `atMs` / `every` / `triggerAtBytes` so tests can pin exactly when
 * the failure manifests.
 */
export type ControllerFault =
  /** Drop the next `ok` ack so the host sees a stuck stream. */
  | { type: 'drop-ok'; afterLine: number }
  /** Insert `latencyMs` of virtual delay before each ack. */
  | { type: 'slow-ack'; latencyMs: number; appliesTo?: 'all' | 'status' | 'gcode' }
  /** Reply `error:N` to a matching command instead of `ok`. */
  | { type: 'inject-error'; code: number; afterCommand?: string | RegExp }
  /** Push the simulator into Alarm state. */
  | {
      type: 'enter-alarm';
      alarmCode: number;
      trigger: 'after-command' | 'after-ms' | 'on-realtime-byte';
      param?: unknown;
    }
  /** Emit a malformed `<…>` status reply. */
  | {
      type: 'malformed-status';
      every?: number;
      pattern?: 'truncated' | 'invalid-token' | 'wrong-mask';
    }
  /** Close the transport mid-flight. */
  | { type: 'disconnect'; atMs?: number; afterLine?: number; afterCommand?: string }
  /** Pretend the host's outbound buffer overflowed. */
  | { type: 'buffer-overflow'; triggerAtBytes: number }
  /** Drop the rest of a write after N bytes (transport split). */
  | { type: 'partial-write'; dropAfterBytes: number }
  /** Never emit the welcome banner. */
  | { type: 'baud-mismatch' }
  /** Mutate or omit fields from a `$$` settings dump. */
  | { type: 'corrupt-settings-dump'; missing?: string[]; mutate?: Record<string, string> }
  /** Replay a pre-disconnect status report after reconnect. */
  | { type: 'stale-response-after-reconnect' }
  /** Reader rejects mid-loop — simulates Web Serial cancel race. */
  | { type: 'reader-throws-mid-loop' }
  /** Writer rejects writes that arrive after a close has started. */
  | { type: 'writer-rejects-after-close' };

export type ControllerFaultType = ControllerFault['type'];

/**
 * The trigger shape the queue exposes to the simulator. Each
 * matchPredicate is a small function the simulator calls with the
 * relevant context; it returns true if the fault should fire NOW.
 *
 * Returns a list of matched faults so a single line / event can fire
 * multiple compatible faults — e.g. a `slow-ack` AND `drop-ok` could
 * both apply to the same ack.
 */
export interface SimulationContext {
  /** 1-based line counter — bumps on each command sent. */
  lineNumber?: number;
  /** Most recent command line (raw). */
  command?: string;
  /** Virtual time in ms since simulator start. */
  nowMs?: number;
  /** Cumulative bytes sent over the transport. */
  bytesSent?: number;
  /** Realtime byte just received (single character). */
  realtimeByte?: string;
  /** True if the simulator has just emitted a status reply. */
  emittingStatus?: boolean;
}

/**
 * Decide whether `fault` should fire right now given `ctx`. Faults
 * with no trigger field for the supplied context are not matched.
 */
export function faultMatches(fault: ControllerFault, ctx: SimulationContext): boolean {
  switch (fault.type) {
    case 'drop-ok':
      return ctx.lineNumber != null && ctx.lineNumber >= fault.afterLine;
    case 'slow-ack':
      // Caller filters by `appliesTo`; this matcher just signals "yes apply".
      return true;
    case 'inject-error':
      if (fault.afterCommand == null) return ctx.command != null;
      if (ctx.command == null) return false;
      if (typeof fault.afterCommand === 'string') return ctx.command.startsWith(fault.afterCommand);
      return fault.afterCommand.test(ctx.command);
    case 'enter-alarm':
      switch (fault.trigger) {
        case 'after-command':
          if (ctx.command == null) return false;
          if (typeof fault.param === 'string') return ctx.command.startsWith(fault.param);
          if (fault.param instanceof RegExp) return fault.param.test(ctx.command);
          return true;
        case 'after-ms':
          return ctx.nowMs != null && typeof fault.param === 'number'
            && ctx.nowMs >= fault.param;
        case 'on-realtime-byte':
          if (ctx.realtimeByte == null) return false;
          if (typeof fault.param === 'string') return ctx.realtimeByte === fault.param;
          return true;
      }
      return false;
    case 'malformed-status':
      return ctx.emittingStatus === true;
    case 'disconnect':
      if (fault.atMs != null && ctx.nowMs != null) return ctx.nowMs >= fault.atMs;
      if (fault.afterLine != null && ctx.lineNumber != null) return ctx.lineNumber >= fault.afterLine;
      if (fault.afterCommand != null && ctx.command != null) {
        return ctx.command.startsWith(fault.afterCommand);
      }
      return false;
    case 'buffer-overflow':
      return ctx.bytesSent != null && ctx.bytesSent >= fault.triggerAtBytes;
    case 'partial-write':
      // Trigger is "always after the threshold bytes are queued" — the
      // simulator chooses where to split.
      return ctx.bytesSent != null && ctx.bytesSent >= fault.dropAfterBytes;
    case 'baud-mismatch':
    case 'stale-response-after-reconnect':
    case 'reader-throws-mid-loop':
    case 'writer-rejects-after-close':
      // Lifecycle faults — applied unconditionally when present.
      return true;
    case 'corrupt-settings-dump':
      // Only applies during a $$ response; caller filters.
      return true;
  }
}

/**
 * Pending fault, plus a one-shot consumed flag so a single fault
 * fires at most once. Multi-fire faults (`slow-ack`, `malformed-
 * status` with `every`) are NOT consumed by this layer; the caller
 * decides when to remove them via `consume(id)`.
 */
interface PendingFault {
  id: number;
  fault: ControllerFault;
  consumed: boolean;
}

/**
 * Test-time queue of faults the simulator should consider before
 * acting on each event. The simulator iterates `match(ctx)`, applies
 * each returned fault, and explicitly consumes one-shot faults via
 * `consume(id)`.
 *
 * `applyChaosFaults` (T2-50-followup with the simulator) layers a
 * seeded random-fault generator on top of this queue.
 */
export class FaultQueue {
  private _next = 1;
  private _faults: PendingFault[] = [];

  inject(fault: ControllerFault): number {
    const id = this._next++;
    this._faults.push({ id, fault, consumed: false });
    return id;
  }

  consume(id: number): void {
    const f = this._faults.find((p) => p.id === id);
    if (f) f.consumed = true;
  }

  clear(): void {
    this._faults = [];
  }

  get pending(): ReadonlyArray<{ id: number; fault: ControllerFault }> {
    return this._faults
      .filter((p) => !p.consumed)
      .map((p) => ({ id: p.id, fault: p.fault }));
  }

  /**
   * Return all currently-pending faults whose match predicate fires
   * for `ctx`. Order is insertion order — tests that need different
   * ordering should clear and re-inject.
   */
  match(ctx: SimulationContext): Array<{ id: number; fault: ControllerFault }> {
    return this._faults
      .filter((p) => !p.consumed && faultMatches(p.fault, ctx))
      .map((p) => ({ id: p.id, fault: p.fault }));
  }

  /**
   * Helper for filter-by-type matching. Useful when the simulator
   * is dispatching at one specific extension point ("on next ack").
   */
  matchOfType<K extends ControllerFaultType>(
    ctx: SimulationContext,
    type: K,
  ): Array<{ id: number; fault: Extract<ControllerFault, { type: K }> }> {
    return this.match(ctx)
      .filter((m): m is { id: number; fault: Extract<ControllerFault, { type: K }> } =>
        m.fault.type === type)
      .map((m) => m);
  }
}

/**
 * Seeded chaos source. Mulberry32 PRNG so a `seed` reproduces the
 * exact same sequence of fault-injection decisions across runs.
 * Returns a value in `[0, 1)` — the simulator compares to `fault
 * Probability` and picks a fault from `catalog` when over the bar.
 */
export function makeChaosRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
