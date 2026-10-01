import { randomUUID } from 'node:crypto';
import { KerfDeskMcpError } from '../mcp/backend.js';

export type RendererCommand = {
  readonly id: string;
  readonly command: string;
  readonly args: Record<string, unknown>;
  readonly clientId: string;
  readonly canWrite: boolean;
};
type Pending = {
  readonly request: RendererCommand;
  readonly resolve: (value: Record<string, unknown>) => void;
  readonly reject: (error: KerfDeskMcpError) => void;
  readonly cleanup: () => void;
  delivered: boolean;
};

/** A renderer replacement cancels every old request, including delivered text work. */
class RemoteRendererQueue {
  private session: string | null = null;
  private readonly pending = new Map<string, Pending>();
  private cancelled: string[] = [];
  attach(): string {
    this.detach();
    this.session = randomUUID();
    return this.session;
  }
  detach(): void {
    this.session = null;
    for (const item of this.pending.values()) {
      item.cleanup();
      item.reject(new KerfDeskMcpError('unavailable'));
    }
    this.pending.clear();
    this.cancelled = [];
  }
  ready(): boolean {
    return this.session !== null;
  }
  owns(value: unknown): boolean {
    return typeof value === 'string' && value === this.session;
  }
  poll(value: string): { requests: RendererCommand[]; cancelled: string[] } {
    if (value !== this.session) throw new KerfDeskMcpError('unavailable');
    const items = [...this.pending.values()];
    const next = items.some((item) => item.delivered)
      ? undefined
      : items.find((item) => !item.delivered);
    if (next !== undefined) next.delivered = true;
    const result = {
      requests: next === undefined ? [] : [next.request],
      cancelled: this.cancelled,
    };
    this.cancelled = [];
    return result;
  }
  complete(value: string, id: string, result: Record<string, unknown> | KerfDeskMcpError): boolean {
    if (value !== this.session) return false;
    const item = this.pending.get(id);
    if (item === undefined || !item.delivered) return false;
    this.pending.delete(id);
    item.cleanup();
    if (result instanceof KerfDeskMcpError) item.reject(result);
    else item.resolve(result);
    return true;
  }
  request(
    command: string,
    args: Record<string, unknown>,
    clientId: string,
    canWrite: boolean,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (this.session === null || this.pending.size >= 32)
      return Promise.reject(new KerfDeskMcpError('unavailable'));
    if (signal?.aborted === true) return Promise.reject(new KerfDeskMcpError('cancelled'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        const item = this.pending.get(id);
        if (item === undefined) return;
        this.pending.delete(id);
        if (item.delivered) this.cancelled.push(id);
        item.cleanup();
        reject(new KerfDeskMcpError('cancelled'));
      };
      const timer = setTimeout(cancel, 20_000);
      timer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, {
        request: { id, command, args, clientId, canWrite },
        resolve,
        reject,
        delivered: false,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
        },
      });
    });
  }
}
export const createRemoteRendererQueue = () => new RemoteRendererQueue();
export type { RemoteRendererQueue };
