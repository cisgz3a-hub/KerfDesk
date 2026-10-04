import { REMOTE_CONTROL_TTL_MS, type RemoteClient } from './relay-types.js';

type Pending = { readonly requestId: string; readonly startedAt: number };

export function validControlLifetime(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= REMOTE_CONTROL_TTL_MS
  );
}

/** Only a correlated relay snapshot may establish a monotonic control lease. */
export class RemoteControlLease {
  private pending: Pending | null = null;
  private readonly deadlines = new Map<string, number>();
  constructor(private readonly now: () => number = () => performance.now()) {}

  begin(requestId: string): void {
    this.pending = { requestId, startedAt: this.now() };
  }

  reset(): void {
    this.pending = null;
    this.deadlines.clear();
  }

  receive(requestId: unknown, clients: readonly RemoteClient[]): boolean {
    const pending = this.pending;
    const matching = pending !== null && requestId === pending.requestId;
    if (matching) this.pending = null;
    for (const id of this.deadlines.keys())
      if (!clients.some((client) => client.id === id && client.scopes.includes('control')))
        this.deadlines.delete(id);
    for (const client of clients) this.update(client, matching ? pending : null);
    // Pushes have no local timing owner and cannot renew a deadline. Query once to verify them.
    return !matching && this.pending === null && clients.some((c) => c.scopes.includes('control'));
  }

  private update(client: RemoteClient, pending: Pending | null): void {
    if (!client.scopes.includes('control')) return;
    if (!validControlLifetime(client.controlExpiresInMs) || client.controlExpiresInMs === 0)
      this.deadlines.delete(client.id);
    else if (pending !== null)
      // Subtract the complete request round trip, including service processing and delivery.
      this.deadlines.set(client.id, pending.startedAt + client.controlExpiresInMs);
  }

  remaining(clientId: string): number {
    return Math.max(0, Math.floor((this.deadlines.get(clientId) ?? 0) - this.now()));
  }

  project(clients: readonly RemoteClient[]): RemoteClient[] {
    return clients.map((client) =>
      client.scopes.includes('control')
        ? { ...client, controlExpiresInMs: this.remaining(client.id) }
        : client,
    );
  }
}
