import { COMMAND_TIMEOUT_MS, type GrantProps } from './protocol.js';

type StopCode = 'cancelled' | 'unavailable';
type Exchange = {
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

  begin(key: string, props: GrantProps, connectionId: string | null): boolean {
    if (!/^[a-f0-9]{64}$/.test(key) || this.active.has(key) || this.active.size >= 32) return false;
    const entry: Exchange = {
      clientId: props.clientId,
      leaseId: props.leaseId,
      connectionId,
      cancelled: false,
      timer: setTimeout(() => this.remove(key, entry, 'unavailable'), COMMAND_TIMEOUT_MS),
    };
    this.active.set(key, entry);
    return true;
  }

  attach(
    key: string,
    props: GrantProps,
    connectionId: string,
    requestId: string,
    stop: (code: StopCode) => void,
  ): boolean {
    const entry = this.lookup(key, props);
    if (!entry || entry.cancelled || entry.requestId || entry.connectionId !== connectionId)
      return false;
    entry.requestId = requestId;
    entry.stop = stop;
    return true;
  }

  detach(key: string, requestId: string): void {
    const entry = this.active.get(key);
    if (entry?.requestId === requestId) entry.stop = undefined;
  }

  cancel(key: string, props: GrantProps): void {
    const entry = this.lookup(key, props);
    if (!entry) return;
    entry.cancelled = true;
    entry.stop?.('cancelled');
    entry.stop = undefined;
  }

  end(key: string, props: GrantProps): void {
    const entry = this.lookup(key, props);
    if (entry) this.remove(key, entry, 'cancelled');
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
