import { COMMAND_TIMEOUT_MS, type GrantProps, type McpReservation } from './protocol.js';

type StopCode = 'cancelled' | 'unavailable';
type Exchange = {
  id: string;
  clientId: string;
  leaseId: string;
  connectionId: string | null;
  cancelled: boolean;
  requestId?: string;
  stop?: (code: StopCode) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Ephemeral authenticated wire associations; never shared across isolates or persisted. */
export class McpRequests {
  private readonly active = new Map<string, Exchange>();

  begin(key: string, props: GrantProps, connectionId: string | null): string | null {
    if (!/^[a-f0-9]{64}$/.test(key) || this.active.has(key) || this.active.size >= 32) return null;
    const entry: Exchange = {
      id: crypto.randomUUID(),
      clientId: props.clientId,
      leaseId: props.leaseId,
      connectionId,
      cancelled: false,
      timer: setTimeout(() => this.remove(key, entry, 'unavailable'), COMMAND_TIMEOUT_MS),
    };
    this.active.set(key, entry);
    return entry.id;
  }

  attach(
    reservation: McpReservation,
    props: GrantProps,
    connectionId: string,
    requestId: string,
    stop: (code: StopCode) => void,
  ): boolean {
    const entry = this.lookup(reservation.key, props);
    if (
      !entry ||
      entry.id !== reservation.id ||
      entry.cancelled ||
      entry.requestId ||
      entry.connectionId !== connectionId
    )
      return false;
    entry.requestId = requestId;
    entry.stop = stop;
    return true;
  }

  detach(reservation: McpReservation, requestId: string): void {
    const entry = this.active.get(reservation.key);
    if (entry?.id === reservation.id && entry.requestId === requestId) entry.stop = undefined;
  }

  cancel(key: string, props: GrantProps): void {
    const entry = this.lookup(key, props);
    if (!entry) return;
    entry.cancelled = true;
    entry.stop?.('cancelled');
    entry.stop = undefined;
  }

  end(reservation: McpReservation, props: GrantProps): void {
    const entry = this.lookup(reservation.key, props);
    if (entry?.id === reservation.id) this.remove(reservation.key, entry, 'cancelled');
  }

  revoke(clientId: string): void {
    for (const [key, entry] of this.active)
      if (entry.clientId === clientId) this.remove(key, entry, 'cancelled');
  }

  private lookup(key: string, props: GrantProps): Exchange | undefined {
    const entry = this.active.get(key);
    return entry?.clientId === props.clientId && entry.leaseId === props.leaseId
      ? entry
      : undefined;
  }

  private remove(key: string, entry: Exchange, code: StopCode): void {
    if (this.active.get(key) !== entry) return;
    this.active.delete(key);
    clearTimeout(entry.timer);
    entry.stop?.(code);
  }
}
