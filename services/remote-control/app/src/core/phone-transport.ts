import { RemoteError, type LiveEvent, type RemoteTransport } from './transport';
import type { PhoneSession, Scope } from './types';

const PAIRING_REJECTED =
  'The PC didn’t accept that code. On the PC, check Phone & MCP says Ready to pair, then use the newest code exactly as shown, including capitals.';

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type SessionState =
  | { status: 'approved'; session: PhoneSession }
  | { status: 'pending'; expiresInMs: number }
  | { status: 'unavailable' };

export async function readSession(): Promise<SessionState> {
  let response: Response;
  try {
    response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new RemoteError(
      'offline',
      'No connection. Check this phone’s internet connection.',
      true,
    );
  }
  const data = await json(response);
  if (data.status === 'pending' && typeof data.expiresInMs === 'number')
    return { status: 'pending', expiresInMs: data.expiresInMs };
  if (data.status !== 'approved' || typeof data.csrf !== 'string') return { status: 'unavailable' };
  const client = data.client as PhoneSession['client'];
  return {
    status: 'approved',
    session: {
      deviceLabel: typeof data.deviceLabel === 'string' ? data.deviceLabel : 'KerfDesk computer',
      online: data.online === true,
      client,
      csrf: data.csrf,
    },
  };
}

export async function claimPairing(input: {
  deviceId: string;
  code: string;
  clientLabel: string;
  requestedScopes: Scope[];
}): Promise<{ expiresInMs: number }> {
  let response: Response;
  try {
    response = await fetch('/api/pair/claim', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, ...input, deviceId: input.deviceId.toLowerCase() }),
    });
  } catch {
    throw new RemoteError('offline', 'No connection. Check this phone’s internet connection.');
  }
  const data = await json(response);
  if (response.status === 429) throw new RemoteError('rate_limited');
  if (!response.ok || typeof data.expiresInMs !== 'number')
    throw new RemoteError('forbidden', PAIRING_REJECTED);
  return { expiresInMs: data.expiresInMs };
}

/** Cookie session, CSRF header and a live socket for changes and held-jog heartbeats. */
export class PhoneTransport implements RemoteTransport {
  readonly kind = 'phone' as const;
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: LiveEvent) => void>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private closed = false;
  constructor(
    private session: PhoneSession,
    private readonly onUnauthorized: () => void,
  ) {}

  updateSession(session: PhoneSession): void {
    this.session = session;
  }

  async call<T = Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch('/api/client/command', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-KerfDesk-CSRF': this.session.csrf },
        body: JSON.stringify({ name: command, args }),
        signal: options.signal ?? AbortSignal.timeout(25_000),
      });
    } catch {
      throw new RemoteError(
        'offline',
        'No connection to the PC. Check this phone’s internet connection.',
        true,
      );
    }
    const data = await json(response);
    if (response.status === 401) {
      this.onUnauthorized();
      throw new RemoteError(
        'forbidden',
        'This phone is no longer approved. Pair it again on the PC.',
      );
    }
    if (response.status === 429) throw new RemoteError('rate_limited');
    if (response.status === 403) throw new RemoteError('forbidden');
    const error = data.error as { code?: string } | undefined;
    if (!response.ok || error !== undefined)
      throw new RemoteError(error?.code ?? 'failed', undefined, response.status >= 500);
    return (data.result ?? {}) as T;
  }

  subscribe(listener: (event: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.socket === null && !this.closed) this.connect();
    return () => {
      this.listeners.delete(listener);
    };
  }

  socketOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  heartbeat(operationId: string): void {
    if (this.socketOpen()) this.socket?.send(JSON.stringify({ type: 'hold.beat', operationId }));
  }

  releaseHolds(): void {
    if (this.socketOpen()) this.socket?.send(JSON.stringify({ type: 'hold.release' }));
  }

  async revoke(): Promise<void> {
    await fetch('/api/client/revoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-KerfDesk-CSRF': this.session.csrf },
      body: '{}',
    }).catch(() => undefined);
    this.close();
  }

  async pushKey(): Promise<string | null> {
    const response = await fetch('/api/push/key', { cache: 'no-store' }).catch(() => null);
    if (response === null || !response.ok) return null;
    const data = await json(response);
    return typeof data.publicKey === 'string' ? data.publicKey : null;
  }

  async savePush(subscription: PushSubscriptionJSON | null): Promise<boolean> {
    const response = await fetch('/api/client/push', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-KerfDesk-CSRF': this.session.csrf },
      body: JSON.stringify({
        subscription:
          subscription === null
            ? null
            : { endpoint: subscription.endpoint, keys: subscription.keys },
      }),
    }).catch(() => null);
    return response?.ok === true;
  }

  close(): void {
    this.closed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    if (this.ping !== null) clearInterval(this.ping);
    this.socket?.close();
    this.socket = null;
  }

  private emit(event: LiveEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private connect(): void {
    const url = new URL('/api/client/socket', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.schedule();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.emit({ type: 'socket', open: true });
      if (this.ping !== null) clearInterval(this.ping);
      this.ping = setInterval(() => {
        if (this.socketOpen()) socket.send('{"type":"ping"}');
      }, 25_000);
    });
    socket.addEventListener('message', (message) => this.receive(message.data));
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.ping !== null) clearInterval(this.ping);
      this.emit({ type: 'socket', open: false });
      this.schedule();
    });
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if ((value.type === 'changed' || value.type === 'hello') && typeof value.revision === 'string')
      this.emit({
        type: 'changed',
        revision: value.revision,
        machineSeq: Number(value.machineSeq) || 0,
      });
    if (value.type === 'hello' || value.type === 'presence' || value.type === 'pong')
      if (typeof value.online === 'boolean') this.emit({ type: 'presence', online: value.online });
    if (
      value.type === 'event' &&
      (value.kind === 'job.finished' ||
        value.kind === 'job.stopped' ||
        value.kind === 'machine.alarm')
    )
      this.emit({ type: 'event', kind: value.kind });
  }

  private schedule(): void {
    if (this.closed || this.listeners.size === 0) return;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5));
    this.retry = setTimeout(() => {
      this.retry = null;
      if (document.visibilityState === 'visible') this.connect();
      else this.schedule();
    }, wait);
  }
}
