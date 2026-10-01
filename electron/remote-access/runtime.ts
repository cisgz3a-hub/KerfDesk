import type { RemoteCredentialStore, RemoteIdentity } from './credential-store.js';
import {
  createRemoteRelayClient,
  validRemoteScopes,
  identifier,
  object,
  type RelayMessage,
} from './relay-client.js';
import {
  REMOTE_ORIGIN,
  type PairingOffer,
  type PairingRequest,
  type RemoteAccessStatus,
  type RemoteClient,
  type RemoteScope,
} from './relay-types.js';
import type { RemoteRendererQueue } from './renderer-queue.js';

function expires(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > Date.now() &&
    value <= Date.now() + 310_000
  );
}
function parseOffer(message: RelayMessage): PairingOffer | null {
  return typeof message.code === 'string' &&
    /^[A-Za-z0-9-]{12,24}$/.test(message.code) &&
    expires(message.expiresAt)
    ? { code: message.code, expiresAt: message.expiresAt }
    : null;
}
function parsePairRequest(message: RelayMessage): PairingRequest | null {
  if (
    !identifier(message.pairingId) ||
    typeof message.clientLabel !== 'string' ||
    message.clientLabel.length > 128 ||
    !validRemoteScopes(message.requestedScopes) ||
    !expires(message.expiresAt)
  )
    return null;
  return {
    pairingId: message.pairingId,
    clientLabel: message.clientLabel,
    requestedScopes: message.requestedScopes,
    expiresAt: message.expiresAt,
  };
}
function parseClient(value: unknown): RemoteClient | null {
  if (
    !object(value) ||
    !identifier(value.id) ||
    typeof value.label !== 'string' ||
    value.label.length > 128 ||
    !validRemoteScopes(value.scopes)
  )
    return null;
  if (
    typeof value.createdAt !== 'number' ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0
  )
    return null;
  return { id: value.id, label: value.label, scopes: value.scopes, createdAt: value.createdAt };
}
function parseClients(value: unknown): RemoteClient[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const clients: RemoteClient[] = [];
  for (const item of value) {
    const client = parseClient(item);
    if (client === null) return null;
    clients.push(client);
  }
  return new Set(clients.map((client) => client.id)).size === clients.length ? clients : null;
}

class RemoteAccessRuntime {
  private identity: RemoteIdentity | null = null;
  private available = true;
  private connected = false;
  private initialized = false;
  private error: string | null = null;
  private pairing: PairingOffer | null = null;
  private requests: PairingRequest[] = [];
  private clients: RemoteClient[] = [];
  private revocationId: string | null = null;
  private waitingClients = false;
  private revoking = false;
  private revocationEpoch = 0;
  private configurationEpoch = 0;
  private clientRevocationEpoch = 0;
  private readonly blockedClients = new Map<string, number>();
  private serial: Promise<unknown> = Promise.resolve();
  private readonly relay: ReturnType<typeof createRemoteRelayClient>;
  constructor(
    private readonly store: RemoteCredentialStore,
    private readonly queue: RemoteRendererQueue,
  ) {
    this.relay = createRemoteRelayClient({
      queue,
      canRequest: (clientId, scopes) => this.canRequest(clientId, scopes),
      onConnection: (open) => this.connection(open),
      onMessage: (message) => this.receive(message),
    });
  }
  private canRequest(clientId: string, scopes: RemoteScope[]): boolean {
    return (
      this.connected &&
      !this.revoking &&
      !this.blockedClients.has(clientId) &&
      this.identity?.enabled === true &&
      !this.identity.revokeOnConnect &&
      !this.waitingClients &&
      this.clients.some(
        (item) => item.id === clientId && scopes.every((scope) => item.scopes.includes(scope)),
      )
    );
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.serial.then(action);
    this.serial = result.catch(() => undefined);
    return result;
  }
  private async persist(value: RemoteIdentity): Promise<void> {
    await this.store.write(value);
    this.identity = value;
  }
  private listClients(): void {
    this.waitingClients = true;
    this.relay.send({ type: 'clients.list', requestId: this.relay.requestId() });
  }
  private revokeAllConnected(): void {
    this.revocationId = this.relay.requestId();
    this.relay.send({ type: 'clients.revokeAll', requestId: this.revocationId });
  }
  private connection(open: boolean): void {
    this.connected = open;
    this.pairing = null;
    this.requests = [];
    this.clients = [];
    if (!open) {
      this.waitingClients = false;
      this.error =
        this.identity?.enabled === true
          ? 'The computer is offline. Remote access will reconnect automatically.'
          : null;
      return;
    }
    this.error = null;
    if (this.identity?.revokeOnConnect === true) this.revokeAllConnected();
    else {
      for (const clientId of this.blockedClients.keys())
        this.relay.send({ type: 'client.revoke', clientId });
      this.listClients();
    }
  }
  private receive(message: RelayMessage): void {
    switch (message.type) {
      case 'pair.offer':
        this.pairing = parseOffer(message);
        break;
      case 'pair.request':
        this.receivePair(message);
        break;
      case 'clients': {
        const checked = parseClients(message.clients);
        if (checked !== null) {
          this.clients = checked;
          this.waitingClients = false;
          this.finishClientRevocations(checked);
        }
        break;
      }
      case 'clients.revoked':
        this.receiveRevocation(message);
        break;
    }
  }
  private receivePair(message: RelayMessage): void {
    const request = parsePairRequest(message);
    if (
      request === null ||
      this.requests.length >= 8 ||
      this.requests.some((item) => item.pairingId === request.pairingId)
    )
      return;
    this.requests = [...this.requests, request];
    this.pairing = null;
  }
  private receiveRevocation(message: RelayMessage): void {
    if (message.requestId !== this.revocationId || this.identity === null) return;
    this.revocationId = null;
    const epoch = this.revocationEpoch;
    void this.enqueue(async () => {
      if (this.identity === null || epoch !== this.revocationEpoch) return;
      await this.persist({ ...this.identity, revokeOnConnect: false, pendingRevocations: [] });
      if (epoch !== this.revocationEpoch) return;
      this.blockedClients.clear();
      this.revoking = false;
      this.listClients();
    }).catch(() => {
      this.available = false;
      this.relay.close();
    });
  }
  private finishClientRevocations(clients: RemoteClient[]): void {
    const cleared = [...this.blockedClients.entries()].filter(
      ([id]) => !clients.some((client) => client.id === id),
    );
    if (cleared.length === 0) return;
    void this.enqueue(async () => {
      if (this.identity === null) return;
      const matching = cleared.filter(([id, epoch]) => this.blockedClients.get(id) === epoch);
      const pendingRevocations = this.identity.pendingRevocations.filter(
        (id) => !matching.some(([clearedId]) => clearedId === id),
      );
      await this.persist({ ...this.identity, pendingRevocations });
      for (const [id, epoch] of matching)
        if (this.blockedClients.get(id) === epoch) this.blockedClients.delete(id);
    }).catch(() => {
      this.available = false;
      this.relay.close();
    });
  }
  status(): RemoteAccessStatus {
    return {
      available: this.available,
      enabled: this.identity?.enabled === true,
      connected: this.connected,
      deviceId: this.identity?.deviceId ?? null,
      controlUrl:
        this.identity === null
          ? `${REMOTE_ORIGIN}/control`
          : `${REMOTE_ORIGIN}/control?deviceId=${encodeURIComponent(this.identity.deviceId)}`,
      mcpUrl: `${REMOTE_ORIGIN}/mcp`,
      pairing: this.pairing !== null && this.pairing.expiresAt > Date.now() ? this.pairing : null,
      requests: this.requests.filter((item) => item.expiresAt > Date.now()),
      clients: this.clients,
      error: this.error,
    };
  }
  opened(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.initialized) {
        this.initialized = true;
        try {
          this.identity = await this.store.read();
          for (const id of this.identity?.pendingRevocations ?? [])
            this.blockedClients.set(id, ++this.clientRevocationEpoch);
          this.revoking = this.identity?.revokeOnConnect === true;
        } catch {
          this.available = false;
          this.error = 'Saved remote settings could not be opened securely.';
        }
      }
      if (this.available && this.identity?.enabled === true && this.queue.ready())
        this.relay.start(this.identity);
    });
  }
  closed(): void {
    this.relay.close();
  }
  configure(enabled: boolean): Promise<RemoteAccessStatus> {
    const epoch = ++this.configurationEpoch;
    if (!enabled) {
      this.revoking = true;
      this.revocationEpoch += 1;
      this.relay.close();
    }
    return this.enqueue(async () => {
      if (!this.available || !this.queue.ready()) throw new Error('Remote access is unavailable.');
      const next = {
        ...(this.identity ?? this.store.create()),
        enabled,
        revokeOnConnect: !enabled || this.identity?.revokeOnConnect === true,
      };
      if (!enabled) this.relay.close();
      try {
        await this.persist(next);
      } catch {
        this.available = false;
        this.error = 'Remote settings could not be saved securely.';
        this.relay.close();
        throw new Error(this.error);
      }
      if (enabled && epoch === this.configurationEpoch) this.relay.start(next);
      return this.status();
    });
  }
  pair(): RemoteAccessStatus {
    if (
      !this.connected ||
      !this.relay.send({ type: 'pair.create', requestId: this.relay.requestId() })
    )
      throw new Error('Remote access is offline.');
    this.pairing = null;
    return this.status();
  }
  decide(pairingId: string, approved: boolean, scopes: RemoteScope[]): RemoteAccessStatus {
    const request = this.requests.find(
      (item) => item.pairingId === pairingId && item.expiresAt > Date.now(),
    );
    if (
      !this.connected ||
      request === undefined ||
      !validRemoteScopes(scopes) ||
      !scopes.every((scope) => request.requestedScopes.includes(scope))
    )
      throw new Error('Pairing is unavailable.');
    if (!this.relay.send({ type: 'pair.decide', pairingId, approved, scopes }))
      throw new Error('Remote access is offline.');
    this.requests = this.requests.filter((item) => item.pairingId !== pairingId);
    if (approved) this.listClients();
    return this.status();
  }
  revoke(clientId: string): Promise<RemoteAccessStatus> {
    if (!this.connected || this.revoking || !this.clients.some((item) => item.id === clientId))
      throw new Error('This connection is unavailable.');
    this.waitingClients = true;
    this.blockedClients.set(clientId, ++this.clientRevocationEpoch);
    this.relay.cancelClient(clientId);
    return this.enqueue(async () => {
      if (this.identity === null) throw new Error('Remote access is unavailable.');
      try {
        await this.persist({
          ...this.identity,
          pendingRevocations: [...this.blockedClients.keys()],
        });
      } catch {
        this.available = false;
        this.relay.close();
        throw new Error('Remote revocation could not be saved securely.');
      }
      this.relay.send({ type: 'client.revoke', clientId });
      this.listClients();
      return this.status();
    });
  }
  revokeAll(): Promise<RemoteAccessStatus> {
    this.revoking = true;
    this.revocationEpoch += 1;
    this.relay.cancelRequests();
    this.pairing = null;
    this.requests = [];
    this.clients = [];
    return this.enqueue(async () => {
      try {
        if (this.identity !== null) await this.persist({ ...this.identity, revokeOnConnect: true });
      } catch {
        this.available = false;
        this.relay.close();
        throw new Error('Remote revocation could not be saved securely.');
      }
      this.pairing = null;
      this.requests = [];
      this.clients = [];
      if (this.connected) this.revokeAllConnected();
      return this.status();
    });
  }
}
export const createRemoteAccessRuntime = (
  store: RemoteCredentialStore,
  queue: RemoteRendererQueue,
) => new RemoteAccessRuntime(store, queue);
export type { RemoteAccessRuntime };
