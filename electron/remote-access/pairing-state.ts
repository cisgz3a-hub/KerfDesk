import { identifier, validRemoteScopes, type RelayMessage } from './relay-client.js';
import { REMOTE_PAIR_TTL_MS, type PairingOffer, type PairingRequest } from './relay-types.js';

const OFFER_RESPONSE_MS = 30_000;
type Lease<T> = { readonly value: T; readonly deadline: number };
type Pending = {
  readonly requestId: string;
  readonly startedAt: number;
  readonly deadline: number;
};
type Expiry = { readonly expiresAt: number; readonly expiresInMs: number };
const legacyError =
  'The remote service must be updated before pairing can continue. Try again later.';

function expiry(message: RelayMessage): Expiry | null {
  return typeof message.expiresAt === 'number' &&
    Number.isSafeInteger(message.expiresAt) &&
    message.expiresAt > 0 &&
    typeof message.expiresInMs === 'number' &&
    Number.isSafeInteger(message.expiresInMs) &&
    message.expiresInMs > 0 &&
    message.expiresInMs <= REMOTE_PAIR_TTL_MS
    ? { expiresAt: message.expiresAt, expiresInMs: message.expiresInMs }
    : null;
}
function offer(message: RelayMessage): PairingOffer | null {
  const duration = expiry(message);
  return duration !== null &&
    typeof message.code === 'string' &&
    /^[A-Za-z0-9-]{12,24}$/.test(message.code)
    ? { code: message.code, ...duration }
    : null;
}
function request(message: RelayMessage): PairingRequest | null {
  const duration = expiry(message);
  return duration !== null &&
    identifier(message.pairingId) &&
    typeof message.clientLabel === 'string' &&
    message.clientLabel.length <= 128 &&
    validRemoteScopes(message.requestedScopes)
    ? {
        pairingId: message.pairingId,
        clientLabel: message.clientLabel,
        requestedScopes: message.requestedScopes,
        ...duration,
      }
    : null;
}

/** Presentation leases only: every claim and decision still uses the relay's original expiry. */
export class RemotePairingState {
  private pending: Pending | null = null;
  private pairing: Lease<PairingOffer> | null = null;
  private requests: Lease<PairingRequest>[] = [];
  private readonly seenRequests = new Set<string>();
  private error: string | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}

  reset(): void {
    this.pending = null;
    this.pairing = null;
    this.requests = [];
    this.seenRequests.clear();
    this.error = null;
  }
  begin(requestId: string): void {
    this.reset();
    const now = this.now();
    this.pending = { requestId, startedAt: now, deadline: now + OFFER_RESPONSE_MS };
  }
  private expire(now: number): void {
    if (this.pending !== null && this.pending.deadline <= now) {
      this.pending = null;
      this.error =
        'A new pairing code did not arrive. Check the connection and create another code.';
    }
    if (this.pairing !== null && this.pairing.deadline <= now) this.pairing = null;
    this.requests = this.requests.filter((item) => item.deadline > now);
  }
  private remaining<T extends Expiry>(lease: Lease<T>, now: number): T {
    return {
      ...lease.value,
      expiresInMs: Math.min(REMOTE_PAIR_TTL_MS, Math.ceil(lease.deadline - now)),
    };
  }
  receiveOffer(message: RelayMessage): void {
    const now = this.now();
    this.expire(now);
    const pending = this.pending;
    if (pending === null || message.requestId !== pending.requestId) return;
    this.pending = null;
    const value = offer(message);
    if (value === null) {
      this.error =
        message.expiresInMs === undefined
          ? legacyError
          : 'The new pairing code could not be verified. Create another code.';
      return;
    }
    // A delayed offer cannot give the local UI a fresh five minutes after its Create owner.
    const deadline = Math.min(now + value.expiresInMs, pending.startedAt + REMOTE_PAIR_TTL_MS);
    if (deadline > now) this.pairing = { value, deadline };
  }
  receiveRequest(message: RelayMessage): void {
    const now = this.now();
    this.expire(now);
    if (this.pending !== null) return;
    const value = request(message);
    if (value === null) {
      this.error =
        message.expiresInMs === undefined
          ? legacyError
          : 'The remote approval request could not be verified. Create another code.';
      return;
    }
    if (this.seenRequests.size >= 8 || this.seenRequests.has(value.pairingId)) return;
    const deadline = Math.min(now + value.expiresInMs, this.pairing?.deadline ?? Infinity);
    if (deadline <= now) return;
    this.seenRequests.add(value.pairingId);
    this.requests.push({ value, deadline });
    this.pairing = null;
  }
  getRequest(pairingId: string): PairingRequest | undefined {
    const now = this.now();
    this.expire(now);
    const item = this.requests.find((lease) => lease.value.pairingId === pairingId);
    return item === undefined ? undefined : this.remaining(item, now);
  }
  removeRequest(pairingId: string): void {
    this.requests = this.requests.filter((item) => item.value.pairingId !== pairingId);
  }
  status() {
    const now = this.now();
    this.expire(now);
    return {
      pairing: this.pairing === null ? null : this.remaining(this.pairing, now),
      pairingPending: this.pending !== null,
      requests: this.requests.map((item) => this.remaining(item, now)),
      error: this.error,
    };
  }
}
