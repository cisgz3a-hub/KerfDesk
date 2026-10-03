import { DurableObject } from 'cloudflare:workers';
import {
  GRANT_TTL_SECONDS,
  oauthScopes,
  type GrantProps,
  type RemoteClient,
  type RemoteScope,
  type StoredClient,
} from './protocol.js';
import { digest, remainingPairingMs, sameDigest } from './security.js';
import {
  CONSENT_TTL_SECONDS,
  CONSENT_STORAGE_PREFIX,
  MAX_CONSENT_RECORDS,
  consentBindingSchema,
  consentDigestSchema,
  consentRecordSchema,
  matchesConsent,
  type ConsentBinding,
} from './consent-state.js';
type Offer = { id: string; digest: string; expiresAt: number; attempts: number; claimed: boolean };
type DeviceState = {
  ownerDigest: string;
  label: string;
  clients: StoredClient[];
  offer: Offer | null;
};

export type SessionInfo =
  | { status: 'unavailable'; online: boolean }
  | { status: 'pending'; online: boolean; expiresInMs: number }
  | {
      status: 'approved';
      online: boolean;
      deviceLabel: string;
      client: RemoteClient;
      leaseId: string;
      sessionExpiresAt: number;
    };

/** Small per-PC approval metadata only. No artwork or command history is stored. */
export abstract class DeviceApprovals extends DurableObject<Env> {
  protected state: DeviceState | null = null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<DeviceState>('device')) ?? null;
    });
  }
  protected abstract owner(): { socket: WebSocket; connectionId: string } | null;
  protected abstract send(value: unknown): boolean;
  protected abstract revokePending(clientId: string): void;
  private approvedClients(): RemoteClient[] {
    return (this.state?.clients ?? [])
      .filter((item) => item.status === 'approved' && item.leaseExpiresAt > Date.now())
      .map(({ id, label, scopes, createdAt }) => ({ id, label, scopes, createdAt }));
  }

  protected sendClients(requestId = crypto.randomUUID()): void {
    this.send({ v: 1, type: 'clients', requestId, clients: this.approvedClients() });
  }

  protected async persist(): Promise<void> {
    if (this.state !== null) await this.ctx.storage.put('device', this.state);
  }

  private pruneConsents(): void {
    for (const [key, value] of this.ctx.storage.kv.list({
      prefix: CONSENT_STORAGE_PREFIX,
      limit: MAX_CONSENT_RECORDS + 1,
    })) {
      const saved = consentRecordSchema.safeParse(value);
      if (!saved.success || saved.data.expiresAt <= Date.now()) this.ctx.storage.kv.delete(key);
    }
  }

  /** Persist a bounded presentation snapshot before returning its consent form. */
  saveConsent(handleDigest: string, value: ConsentBinding): boolean {
    const saved = consentBindingSchema.safeParse(value);
    const scopes = saved.success ? oauthScopes(saved.data.displayedScopes) : null;
    if (
      !consentDigestSchema.safeParse(handleDigest).success ||
      !saved.success ||
      saved.data.expiresAt <= Date.now() ||
      saved.data.expiresAt > Date.now() + CONSENT_TTL_SECONDS * 1000 ||
      !scopes ||
      !this.isAuthorized(saved.data, scopes) ||
      this.sessionInfo(saved.data.clientId, saved.data.sessionDigest).status !== 'approved'
    )
      return false;
    return this.ctx.storage.transactionSync(() => {
      this.pruneConsents();
      const key = `${CONSENT_STORAGE_PREFIX}${handleDigest}`;
      if (
        this.ctx.storage.kv.get(key) !== undefined ||
        Array.from(
          this.ctx.storage.kv.list({ prefix: CONSENT_STORAGE_PREFIX, limit: MAX_CONSENT_RECORDS }),
        ).length >= MAX_CONSENT_RECORDS
      )
        return false;
      this.ctx.storage.kv.put(key, { ...saved.data, consumed: false });
      return true;
    });
  }

  /** No await separates the current approval, immutable snapshot and durable single-use marker. */
  consumeConsent(
    handleDigest: string,
    props: GrantProps,
    sessionDigest: string,
    selectedScopes: string[],
  ): boolean {
    if (!consentDigestSchema.safeParse(handleDigest).success) return false;
    return this.ctx.storage.transactionSync(() => {
      const key = `${CONSENT_STORAGE_PREFIX}${handleDigest}`;
      const saved = consentRecordSchema.safeParse(this.ctx.storage.kv.get(key));
      const scopes = oauthScopes(selectedScopes);
      if (
        !saved.success ||
        saved.data.consumed ||
        !scopes ||
        !this.isAuthorized(props, scopes) ||
        this.sessionInfo(props.clientId, sessionDigest).status !== 'approved' ||
        !matchesConsent(saved.data, props, sessionDigest, selectedScopes)
      )
        return false;
      // Keep the marker until expiry: delayed retries must never recreate a consumed handle.
      this.ctx.storage.kv.put(key, { ...saved.data, consumed: true });
      return true;
    });
  }

  /** Expiry blocks immediately. Physical metadata cleanup happens on the next device interaction. */
  protected async pruneExpired(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.pruneConsents());
    if (!this.state) return;
    const now = Date.now();
    let changed = false;
    if (this.state.offer && this.state.offer.expiresAt <= now) {
      this.state.offer = null;
      changed = true;
    }
    for (const client of [...this.state.clients]) {
      if ((client.status === 'pending' ? client.claimExpiresAt : client.leaseExpiresAt) <= now) {
        this.revoke(client.id);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async register(ownerDigest: string, label: string): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.state !== null) return sameDigest(this.state.ownerDigest, ownerDigest);
      this.state = { ownerDigest, label, clients: [], offer: null };
      await this.persist();
      return true;
    });
  }

  protected sendPairRequest(client: StoredClient): void {
    const expiresInMs = remainingPairingMs(client.claimExpiresAt);
    if (expiresInMs === 0) return;
    this.send({
      v: 1,
      type: 'pair.request',
      pairingId: client.id,
      clientLabel: client.label,
      requestedScopes: client.scopes,
      expiresAt: client.claimExpiresAt,
      expiresInMs,
    });
  }

  async claim(
    code: string,
    clientLabel: string,
    requestedScopes: RemoteScope,
    sessionDigest: string,
  ): Promise<{ clientId: string; expiresAt: number } | null> {
    const codeDigest = await digest(code);
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.pruneExpired();
      const state = this.state;
      const offer = state?.offer;
      if (
        !state ||
        !offer ||
        !this.owner() ||
        offer.claimed ||
        offer.expiresAt <= Date.now() ||
        offer.attempts >= 5
      )
        return null;
      if (!sameDigest(codeDigest, offer.digest)) {
        offer.attempts += 1;
        await this.persist();
        return null;
      }
      state.clients = state.clients.filter(
        (item) => item.status === 'approved' || item.claimExpiresAt > Date.now(),
      );
      if (state.clients.length >= 20) return null;
      offer.claimed = true;
      const client: StoredClient = {
        id: crypto.randomUUID(),
        label: clientLabel,
        scopes: requestedScopes,
        createdAt: Date.now(),
        status: 'pending',
        leaseId: crypto.randomUUID(),
        sessionDigest,
        sessionExpiresAt: offer.expiresAt,
        claimExpiresAt: offer.expiresAt,
        leaseExpiresAt: offer.expiresAt,
      };
      state.clients.push(client);
      await this.persist();
      this.sendPairRequest(client);
      return { clientId: client.id, expiresAt: client.claimExpiresAt };
    });
  }

  protected sessionInfo(clientId: string, sessionDigest: string): SessionInfo {
    const state = this.state;
    const client = state?.clients.find((item) => item.id === clientId);
    if (
      !state ||
      !client ||
      !sameDigest(client.sessionDigest, sessionDigest) ||
      client.sessionExpiresAt <= Date.now() ||
      client.leaseExpiresAt <= Date.now()
    )
      return { status: 'unavailable', online: this.owner() !== null };
    if (client.status === 'pending') {
      const expiresInMs = remainingPairingMs(client.claimExpiresAt);
      if (expiresInMs === 0) return { status: 'unavailable', online: this.owner() !== null };
      return {
        status: 'pending',
        online: this.owner() !== null,
        expiresInMs,
      };
    }
    const { id, label, scopes, createdAt, leaseId } = client;
    return {
      status: 'approved',
      online: this.owner() !== null,
      deviceLabel: state.label,
      client: { id, label, scopes, createdAt },
      leaseId,
      sessionExpiresAt: client.sessionExpiresAt,
    };
  }

  async session(clientId: string, sessionDigest: string): Promise<SessionInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.pruneExpired();
      return this.sessionInfo(clientId, sessionDigest);
    });
  }

  protected isAuthorized(props: GrantProps, scopes: RemoteScope): boolean {
    const client = this.state?.clients.find((item) => item.id === props.clientId);
    return (
      client?.status === 'approved' &&
      client.leaseId === props.leaseId &&
      client.leaseExpiresAt > Date.now() &&
      scopes.every((scope) => client.scopes.includes(scope))
    );
  }

  async authorize(props: GrantProps, scopes: RemoteScope): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.pruneExpired();
      return this.isAuthorized(props, scopes);
    });
  }

  /** Extend once at new OAuth token issuance, never at refresh or phone status checks. */
  async retainGrant(
    props: GrantProps,
    scopes: RemoteScope,
    lifetimeSeconds: number,
  ): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      await this.pruneExpired();
      if (
        !Number.isSafeInteger(lifetimeSeconds) ||
        lifetimeSeconds <= 0 ||
        lifetimeSeconds > GRANT_TTL_SECONDS ||
        !this.isAuthorized(props, scopes)
      )
        return false;
      const client = this.state?.clients.find((item) => item.id === props.clientId);
      if (!client) return false;
      client.leaseExpiresAt = Math.max(client.leaseExpiresAt, Date.now() + lifetimeSeconds * 1000);
      await this.persist();
      return true;
    });
  }

  async revokeSession(clientId: string, sessionDigest: string): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const client = this.state?.clients.find((item) => item.id === clientId);
      if (!client || !sameDigest(client.sessionDigest, sessionDigest)) return false;
      this.revoke(clientId);
      await this.persist();
      this.sendClients();
      return true;
    });
  }

  protected revoke(clientId: string): void {
    if (this.state) this.state.clients = this.state.clients.filter((item) => item.id !== clientId);
    for (const [key, value] of this.ctx.storage.kv.list({
      prefix: CONSENT_STORAGE_PREFIX,
      limit: MAX_CONSENT_RECORDS,
    })) {
      const saved = consentRecordSchema.safeParse(value);
      if (!saved.success || saved.data.clientId === clientId) this.ctx.storage.kv.delete(key);
    }
    this.revokePending(clientId);
  }
}
