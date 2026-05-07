/**
 * T2-32: explicit connection lifecycle state machine foundation.
 *
 * This module is intentionally pure with injectable adapters. It gives the
 * app one lifecycle vocabulary before MachineService/UI call sites migrate.
 */

export type ConnectionLifecycle<TTransport = unknown, TController = unknown> =
  | { readonly state: 'disconnected' }
  | { readonly state: 'selecting'; readonly connectionId: string }
  | { readonly state: 'opening'; readonly connectionId: string; readonly transport: TTransport }
  | { readonly state: 'handshaking'; readonly connectionId: string; readonly transport: TTransport }
  | {
      readonly state: 'ready';
      readonly connectionId: string;
      readonly transport: TTransport;
      readonly controller: TController;
    }
  | { readonly state: 'disconnecting'; readonly connectionId: string }
  | { readonly state: 'error'; readonly error: string; readonly recoverable: boolean }
  | { readonly state: 'stale'; readonly reason: string };

export interface ConnectionManagerOptions {
  readonly idFactory?: () => string;
}

export interface ConnectionCleanupContext<TTransport, TController> {
  readonly connectionId: string;
  readonly transport: TTransport | null;
  readonly controller: TController | null;
}

export interface ConnectOptions<TTransport, TController> {
  readonly selectTransport: (signal: AbortSignal) => Promise<TTransport>;
  readonly openTransport?: (transport: TTransport, signal: AbortSignal) => Promise<void>;
  readonly handshake: (transport: TTransport, signal: AbortSignal) => Promise<TController>;
  readonly cleanup?: (ctx: ConnectionCleanupContext<TTransport, TController>) => Promise<void>;
  readonly disconnectReady?: (ctx: {
    readonly connectionId: string;
    readonly transport: TTransport;
    readonly controller: TController;
  }) => Promise<void>;
}

export type ConnectionSubscriber<TTransport, TController> = (
  state: ConnectionLifecycle<TTransport, TController>,
) => void;

function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ConnectionManager<TTransport = unknown, TController = unknown> {
  private readonly idFactory: () => string;
  private readonly subscribers = new Set<ConnectionSubscriber<TTransport, TController>>();

  private currentState: ConnectionLifecycle<TTransport, TController> = { state: 'disconnected' };
  private activeConnectionId: string | null = null;
  private abortController: AbortController | null = null;
  private activeConnectPromise: Promise<void> | null = null;
  private activeTransport: TTransport | null = null;
  private activeController: TController | null = null;
  private activeDisconnectReady: ConnectOptions<TTransport, TController>['disconnectReady'] | null = null;

  constructor(options: ConnectionManagerOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  get state(): ConnectionLifecycle<TTransport, TController> {
    return this.currentState;
  }

  subscribe(cb: ConnectionSubscriber<TTransport, TController>): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  async connect(options: ConnectOptions<TTransport, TController>): Promise<void> {
    if (
      this.currentState.state !== 'disconnected' &&
      this.currentState.state !== 'error' &&
      this.currentState.state !== 'stale'
    ) {
      throw new Error(`Cannot connect from state ${this.currentState.state}`);
    }

    const connectionId = this.idFactory();
    const abortController = new AbortController();
    this.activeConnectionId = connectionId;
    this.abortController = abortController;
    this.activeTransport = null;
    this.activeController = null;
    this.activeDisconnectReady = options.disconnectReady ?? null;

    const run = this.runConnect(connectionId, abortController, options);
    this.activeConnectPromise = run.finally(() => {
      if (this.activeConnectionId === connectionId) {
        this.activeConnectPromise = null;
      }
    });
    return this.activeConnectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.currentState.state === 'disconnected') return;

    const connectionId = 'connectionId' in this.currentState
      ? this.currentState.connectionId
      : this.activeConnectionId;

    if (connectionId == null) {
      this.clearActive();
      this.setState({ state: 'disconnected' });
      return;
    }

    this.setState({ state: 'disconnecting', connectionId });
    this.abortController?.abort();

    if (this.activeConnectPromise) {
      await this.activeConnectPromise;
    }

    if (this.activeController != null && this.activeTransport != null && this.activeDisconnectReady) {
      await this.activeDisconnectReady({
        connectionId,
        controller: this.activeController,
        transport: this.activeTransport,
      });
    }

    this.clearActive();
    this.setState({ state: 'disconnected' });
  }

  markStale(reason: string): void {
    this.abortController?.abort();
    this.clearActive();
    this.setState({ state: 'stale', reason });
  }

  isStaleConnection(connectionId: string): boolean {
    return this.activeConnectionId !== connectionId;
  }

  assertLiveConnection(connectionId: string): void {
    if (this.isStaleConnection(connectionId)) {
      throw new Error(`Connection ${connectionId} was superseded`);
    }
  }

  private async runConnect(
    connectionId: string,
    abortController: AbortController,
    options: ConnectOptions<TTransport, TController>,
  ): Promise<void> {
    let transport: TTransport | null = null;
    let controller: TController | null = null;

    try {
      this.setState({ state: 'selecting', connectionId });
      transport = await options.selectTransport(abortController.signal);
      this.throwIfAbortedOrStale(connectionId, abortController.signal);
      this.activeTransport = transport;

      this.setState({ state: 'opening', connectionId, transport });
      await options.openTransport?.(transport, abortController.signal);
      this.throwIfAbortedOrStale(connectionId, abortController.signal);

      this.setState({ state: 'handshaking', connectionId, transport });
      controller = await options.handshake(transport, abortController.signal);
      this.throwIfAbortedOrStale(connectionId, abortController.signal);
      this.activeController = controller;

      this.setState({ state: 'ready', connectionId, transport, controller });
    } catch (err: unknown) {
      await options.cleanup?.({ connectionId, transport, controller });

      if (abortController.signal.aborted) {
        if (this.activeConnectionId === connectionId) {
          this.clearActive();
          this.setState({ state: 'disconnected' });
        }
        return;
      }

      if (this.activeConnectionId === connectionId) {
        this.clearActive();
        this.setState({ state: 'error', error: errorMessage(err), recoverable: true });
      }
      throw err;
    }
  }

  private throwIfAbortedOrStale(connectionId: string, signal: AbortSignal): void {
    if (signal.aborted) {
      throw new DOMException('Connection aborted', 'AbortError');
    }
    this.assertLiveConnection(connectionId);
  }

  private clearActive(): void {
    this.activeConnectionId = null;
    this.abortController = null;
    this.activeConnectPromise = null;
    this.activeTransport = null;
    this.activeController = null;
    this.activeDisconnectReady = null;
  }

  private setState(next: ConnectionLifecycle<TTransport, TController>): void {
    this.currentState = next;
    for (const cb of this.subscribers) {
      try {
        cb(next);
      } catch (err: unknown) {
        console.warn('[ConnectionManager] subscriber failed', err);
      }
    }
  }
}
