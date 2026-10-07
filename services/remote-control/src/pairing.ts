import { PAIR_TTL_MS, SESSION_TTL_MS, normalizedScopes, uuid } from './protocol.js';
import { digest, pairingCode, remainingPairingMs } from './security.js';
import { DeviceApprovals } from './approvals.js';

/** The owner socket alone may change pairing and existing approvals. */
export abstract class DevicePairing extends DeviceApprovals {
  private async createOffer(requestId: string): Promise<void> {
    if (!this.state) return;
    for (const item of this.state.clients.filter((client) => client.status === 'pending'))
      this.revoke(item.id);
    const code = pairingCode();
    this.state.offer = {
      id: crypto.randomUUID(),
      digest: await digest(code),
      expiresAt: Date.now() + PAIR_TTL_MS,
      attempts: 0,
      claimed: false,
    };
    await this.persist();
    const expiresAt = this.state.offer.expiresAt;
    const expiresInMs = remainingPairingMs(expiresAt);
    if (expiresInMs === 0) return;
    this.send({ v: 1, type: 'pair.offer', requestId, code, expiresAt, expiresInMs });
  }
  private async decidePair(value: Record<string, unknown>): Promise<void> {
    if (!this.state || typeof value.pairingId !== 'string' || typeof value.approved !== 'boolean')
      return;
    const client = this.state.clients.find((item) => item.id === value.pairingId);
    const scopes = Array.isArray(value.scopes) ? normalizedScopes(value.scopes) : null;
    if (
      !client ||
      client.status !== 'pending' ||
      client.claimExpiresAt <= Date.now() ||
      !scopes ||
      !scopes.every((scope) => client.scopes.includes(scope))
    )
      return;
    if (!value.approved) this.revoke(client.id);
    else {
      client.status = 'approved';
      client.scopes = scopes;
      client.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      client.leaseExpiresAt = client.sessionExpiresAt;
    }
    await this.persist();
    this.sendClients();
  }
  protected async handleMetadata(value: Record<string, unknown>): Promise<void> {
    if (!this.state) return;
    switch (value.type) {
      case 'clients.list':
        if (uuid.safeParse(value.requestId).success) this.sendClients(value.requestId as string);
        break;
      case 'pair.create':
        if (uuid.safeParse(value.requestId).success)
          await this.createOffer(value.requestId as string);
        break;
      case 'pair.decide':
        await this.decidePair(value);
        break;
      case 'client.revoke':
        if (typeof value.clientId !== 'string') return;
        this.revoke(value.clientId);
        await this.persist();
        this.sendClients();
        break;
      case 'clients.revokeAll':
        if (!uuid.safeParse(value.requestId).success) return;
        for (const item of [...this.state.clients]) this.revoke(item.id);
        this.state.offer = null;
        await this.persist();
        this.sendClients();
        this.send({ v: 1, type: 'clients.revoked', requestId: value.requestId });
        break;
    }
  }
}
