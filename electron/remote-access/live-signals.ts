type Observation = { revision: string; machineSeq: number };
type HoldBeat = { clientId: string; operationId: string };
const LIMIT = 64;

/**
 * ADR-582/585 state held by main between renderer polls: the last change counters sent to
 * the relay, and held-jog heartbeats/releases waiting for the renderer's dead-man.
 */
export class RemoteLiveSignals {
  private observed: Observation | null = null;
  private sent = '';
  private readonly beats = new Map<string, HoldBeat>();
  private readonly releases = new Set<string>();

  /** A lost relay can no longer deliver heartbeats: '*' stops every held jog. */
  connection(open: boolean): void {
    this.sent = '';
    this.beats.clear();
    if (!open) this.releases.add('*');
  }

  observe(observed: Observation): void {
    this.observed = observed;
  }

  /** The counters to send now, or null when they were already sent. */
  pending(): Observation | null {
    if (this.observed === null) return null;
    return `${this.observed.revision}#${this.observed.machineSeq}` === this.sent
      ? null
      : this.observed;
  }

  markSent(observed: Observation): void {
    this.sent = `${observed.revision}#${observed.machineSeq}`;
  }

  beat(clientId: string, operationId: string): void {
    if (this.beats.size < LIMIT) this.beats.set(operationId, { clientId, operationId });
  }

  release(clientId: string): void {
    if (this.releases.size < LIMIT) this.releases.add(clientId);
  }

  /** Drained by each renderer poll. */
  take(): { beats?: HoldBeat[]; releases?: string[] } {
    const beats = [...this.beats.values()];
    const releases = [...this.releases];
    this.beats.clear();
    this.releases.clear();
    return {
      ...(beats.length === 0 ? {} : { beats }),
      ...(releases.length === 0 ? {} : { releases }),
    };
  }
}
