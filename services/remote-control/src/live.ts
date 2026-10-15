import { uuid } from './protocol.js';
import { plainObject } from './device-envelope.js';

export type Observation = { revision: string; machineSeq: number };
export type WaitArgs = { sinceRevision?: string; sinceMachineSeq?: number; timeoutMs?: number };
type WaitResult = {
  revision: string;
  machineSeq: number;
  changed: boolean;
  reason: 'workspace' | 'machine' | 'both' | 'timeout' | 'unsupported';
};
type Waiter = {
  args: WaitArgs;
  resolve: (value: WaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
};
type PhoneAttachment = { role: 'client'; clientId: string; sessionDigest: string };
type Hooks = {
  owner(): { socket: WebSocket; connectionId: string } | null;
  sendDesktop(value: unknown): boolean;
  /** Re-checks the live session and scope for a phone socket's client. */
  allowed(clientId: string, sessionDigest: string, scope: 'read' | 'control'): boolean;
};

export const PHONE_TAG = 'phone';
const MAX_WAITERS = 64;
const MAX_PHONE_SOCKETS = 20;
const PHONE_MESSAGES_PER_SECOND = 30;
const DEFAULT_WAIT_MS = 15_000;

export const isPhoneAttachment = (value: unknown): value is PhoneAttachment =>
  plainObject(value) &&
  value.role === 'client' &&
  typeof value.clientId === 'string' &&
  typeof value.sessionDigest === 'string';

/**
 * ADR-582. The desktop reports change counters; this object fans them out to approved phone
 * sockets and resolves `wait_for_change` without contacting the PC. Only counters, event kinds
 * and held-jog heartbeats travel here; never artwork or commands.
 */
export class LiveChannel {
  private readonly waiters = new Map<string, Waiter>();
  private readonly rates = new WeakMap<WebSocket, { second: number; count: number }>();
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly hooks: Hooks,
  ) {}

  latest(): Observation | null {
    const value: unknown = this.hooks.owner()?.socket.deserializeAttachment();
    return plainObject(value) &&
      typeof value.revision === 'string' &&
      Number.isSafeInteger(value.machineSeq)
      ? { revision: value.revision, machineSeq: value.machineSeq as number }
      : null;
  }

  /** Stored in the desktop socket attachment so it survives WebSocket hibernation. */
  observe(socket: WebSocket, value: Record<string, unknown>): void {
    if (
      typeof value.revision !== 'string' ||
      value.revision.length < 1 ||
      value.revision.length > 200 ||
      !Number.isSafeInteger(value.machineSeq) ||
      (value.machineSeq as number) < 0
    )
      return;
    const attachment: unknown = socket.deserializeAttachment();
    if (!plainObject(attachment)) return;
    socket.serializeAttachment({
      ...attachment,
      revision: value.revision,
      machineSeq: value.machineSeq,
    });
    const latest = { revision: value.revision, machineSeq: value.machineSeq as number };
    for (const [id, waiter] of [...this.waiters]) {
      const reason = changeReason(latest, waiter.args);
      if (reason !== null) this.settle(id, { ...latest, changed: true, reason });
    }
    this.broadcast({ type: 'changed', ...latest }, 'read');
  }

  event(kind: unknown): boolean {
    if (kind !== 'job.finished' && kind !== 'job.stopped' && kind !== 'machine.alarm') return false;
    this.broadcast({ type: 'event', kind }, 'read');
    return true;
  }

  wait(requestId: string, args: WaitArgs): Promise<WaitResult> {
    const latest = this.latest();
    if (latest === null)
      return Promise.resolve({
        revision: args.sinceRevision ?? 'unconfirmed',
        machineSeq: args.sinceMachineSeq ?? 0,
        changed: false,
        reason: 'unsupported',
      });
    const reason = changeReason(latest, args);
    if (reason !== null) return Promise.resolve({ ...latest, changed: true, reason });
    if (args.timeoutMs === 0 || this.waiters.size >= MAX_WAITERS || this.waiters.has(requestId))
      return Promise.resolve({ ...latest, changed: false, reason: 'timeout' });
    return new Promise((resolve) => {
      const timer = setTimeout(
        () =>
          this.settle(requestId, {
            ...(this.latest() ?? latest),
            changed: false,
            reason: 'timeout',
          }),
        args.timeoutMs ?? DEFAULT_WAIT_MS,
      );
      this.waiters.set(requestId, { args, resolve, timer });
    });
  }

  cancelWait(requestId: string): boolean {
    const latest = this.latest();
    if (!this.waiters.has(requestId)) return false;
    this.settle(requestId, {
      revision: latest?.revision ?? 'unconfirmed',
      machineSeq: latest?.machineSeq ?? 0,
      changed: false,
      reason: 'timeout',
    });
    return true;
  }

  private settle(id: string, result: WaitResult): void {
    const waiter = this.waiters.get(id);
    if (waiter === undefined) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(id);
    waiter.resolve(result);
  }

  acceptPhone(clientId: string, sessionDigest: string): Response {
    if (this.ctx.getWebSockets(PHONE_TAG).length >= MAX_PHONE_SOCKETS)
      return new Response(null, { status: 503 });
    for (const old of this.phones(clientId)) close(old, 1000, 'Replaced');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [PHONE_TAG]);
    const attachment: PhoneAttachment = { role: 'client', clientId, sessionDigest };
    server.serializeAttachment(attachment);
    const latest = this.latest();
    server.send(
      JSON.stringify({
        type: 'hello',
        online: this.hooks.owner() !== null,
        ...(latest === null ? {} : latest),
      }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  hasPhone(clientId: string): boolean {
    return this.phones(clientId).length > 0;
  }

  phoneMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const parsed = this.phoneEnvelope(socket, message);
    if (parsed === null) return;
    const { attachment, value } = parsed;
    if (value.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', online: this.hooks.owner() !== null }));
      return;
    }
    const hold = value.type === 'hold.beat' || value.type === 'hold.release';
    if (!hold || !this.hooks.allowed(attachment.clientId, attachment.sessionDigest, 'control'))
      return;
    if (value.type === 'hold.release') this.release(attachment.clientId);
    else if (uuid.safeParse(value.operationId).success)
      this.hooks.sendDesktop({
        v: 1,
        type: 'hold.beat',
        clientId: attachment.clientId,
        operationId: value.operationId,
      });
  }

  /** Small JSON from a still-approved, rate-limited phone; anything else closes or drops. */
  private phoneEnvelope(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): { attachment: PhoneAttachment; value: Record<string, unknown> } | null {
    const attachment: unknown = socket.deserializeAttachment();
    if (!isPhoneAttachment(attachment) || typeof message !== 'string' || message.length > 512) {
      close(socket, 1008, 'Invalid message');
      return null;
    }
    if (!this.withinRate(socket)) return null;
    if (!this.hooks.allowed(attachment.clientId, attachment.sessionDigest, 'read')) {
      close(socket, 1008, 'Access ended');
      return null;
    }
    try {
      const value: unknown = JSON.parse(message);
      return plainObject(value) ? { attachment, value } : null;
    } catch {
      close(socket, 1008, 'Invalid message');
      return null;
    }
  }

  phoneClosed(socket: WebSocket): void {
    const attachment: unknown = socket.deserializeAttachment();
    if (isPhoneAttachment(attachment)) this.release(attachment.clientId);
  }

  /** Revocation or expiry: close the client's sockets and stop any held jog it owns. */
  closeClient(clientId: string): void {
    for (const socket of this.phones(clientId)) close(socket, 1008, 'Access ended');
    this.release(clientId);
  }

  desktopOnline(online: boolean): void {
    this.broadcast({ type: 'presence', online }, 'read');
  }

  private release(clientId: string): void {
    this.hooks.sendDesktop({ v: 1, type: 'hold.release', clientId });
  }

  private phones(clientId: string): WebSocket[] {
    return this.ctx.getWebSockets(PHONE_TAG).filter((socket) => {
      const value: unknown = socket.deserializeAttachment();
      return isPhoneAttachment(value) && value.clientId === clientId;
    });
  }

  private broadcast(message: Record<string, unknown>, scope: 'read' | 'control'): void {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets(PHONE_TAG)) {
      const value: unknown = socket.deserializeAttachment();
      if (
        !isPhoneAttachment(value) ||
        !this.hooks.allowed(value.clientId, value.sessionDigest, scope)
      ) {
        close(socket, 1008, 'Access ended');
        continue;
      }
      try {
        socket.send(encoded);
      } catch {
        /* A closing socket is cleaned up by its close handler. */
      }
    }
  }

  private withinRate(socket: WebSocket): boolean {
    const second = Math.floor(Date.now() / 1000);
    const rate = this.rates.get(socket);
    if (rate === undefined || rate.second !== second) {
      this.rates.set(socket, { second, count: 1 });
      return true;
    }
    rate.count += 1;
    return rate.count <= PHONE_MESSAGES_PER_SECOND;
  }
}

function changeReason(latest: Observation, args: WaitArgs): WaitResult['reason'] | null {
  const workspace = args.sinceRevision !== undefined && args.sinceRevision !== latest.revision;
  const machine = args.sinceMachineSeq !== undefined && args.sinceMachineSeq !== latest.machineSeq;
  if (workspace && machine) return 'both';
  if (workspace) return 'workspace';
  return machine ? 'machine' : null;
}
function close(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    /* Already closed. */
  }
}
