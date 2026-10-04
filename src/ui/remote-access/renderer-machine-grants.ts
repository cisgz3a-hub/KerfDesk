import type { MachineAuthority } from '../remote-control/machine-types';
import { RemoteFault } from '../remote-control/fault';
import type { RemoteAccessStatus } from './remote-access-store';

type Grant = {
  readonly authority: MachineAuthority;
  readonly controller: AbortController;
  readonly deadline: number;
  readonly cancelTimer: () => void;
};

function expiryTimer(deadline: number, controller: AbortController): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const expire = () => {
    const delay = deadline - performance.now();
    if (delay <= 0) controller.abort();
    else timer = setTimeout(expire, Math.min(delay, 2_147_483_647));
  };
  expire();
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
  };
  controller.signal.addEventListener('abort', cancel, { once: true });
  return cancel;
}

/** Accepted actions retain immutable lifetimes; renewed leases authorise new requests. */
export class RendererMachineGrants {
  private readonly grants = new Map<string, Grant>();
  private readonly generations = new Set<Grant>();
  private readonly blocked = new Set<string>();
  private disposed = false;
  constructor(
    private readonly owns: (session: string) => boolean,
    private readonly status: () => RemoteAccessStatus | null,
  ) {}
  private remainingLifetime(clientId: string): number | null {
    const remaining = this.status()?.clients.find(
      (client) => client.id === clientId,
    )?.controlExpiresInMs;
    return typeof remaining === 'number' &&
      Number.isSafeInteger(remaining) &&
      remaining > 0 &&
      remaining <= 30 * 24 * 60 * 60 * 1000
      ? remaining
      : null;
  }
  private allowed(sessionId: string, clientId: string): boolean {
    const current = this.status();
    if (this.disposed || this.blocked.has(`${sessionId}/${clientId}`) || !this.owns(sessionId))
      return false;
    if (current?.enabled !== true || !current.available || !current.connected) return false;
    return (
      this.remainingLifetime(clientId) !== null &&
      current.clients.some((client) => client.id === clientId && client.scopes.includes('control'))
    );
  }
  readonly capture = (
    sessionId: string,
    clientId: string,
    envelopeAllows: boolean,
  ): MachineAuthority | null => {
    if (!envelopeAllows || !this.allowed(sessionId, clientId)) return null;
    const remaining = this.remainingLifetime(clientId);
    if (remaining === null) return null;
    const key = `${sessionId}/${clientId}`;
    const deadline = performance.now() + remaining;
    const existing = this.grants.get(key);
    if (
      existing !== undefined &&
      !existing.controller.signal.aborted &&
      deadline <= existing.deadline + 1
    )
      return existing.authority;
    const controller = new AbortController();
    const authority: MachineAuthority = {
      sessionId,
      clientId,
      signal: controller.signal,
      assertCurrent: () => {
        if (
          controller.signal.aborted ||
          performance.now() >= deadline ||
          !this.allowed(sessionId, clientId)
        ) {
          controller.abort();
          throw new RemoteFault('control_required');
        }
      },
    };
    const grant = {
      authority,
      controller,
      deadline,
      cancelTimer: expiryTimer(deadline, controller),
    };
    this.grants.set(key, grant);
    this.generations.add(grant);
    controller.signal.addEventListener('abort', () => this.generations.delete(grant), {
      once: true,
    });
    return authority;
  };
  readonly observe = (): void => {
    for (const { authority, controller } of this.generations)
      if (!this.allowed(authority.sessionId, authority.clientId)) controller.abort();
  };
  readonly revoke = (clientId: string | null): void => {
    for (const [key, { authority }] of this.grants)
      if (clientId === null || authority.clientId === clientId) this.blocked.add(key);
    for (const { authority, controller } of this.generations)
      if (clientId === null || authority.clientId === clientId) controller.abort();
  };
  readonly dispose = (): void => {
    this.disposed = true;
    for (const { controller, cancelTimer } of this.generations) {
      controller.abort();
      cancelTimer();
    }
    this.grants.clear();
  };
}
