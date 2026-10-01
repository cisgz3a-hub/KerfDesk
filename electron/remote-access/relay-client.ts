import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { KerfDeskMcpError, mcpErrorCode } from '../mcp/backend.js';
import {
  mcpInputSchemas,
  MCP_MAX_RESULT_BYTES,
  type KerfDeskMcpCommand,
} from '../mcp/input-schemas.js';
import { mcpOutputSchemas } from '../mcp/output-schemas.js';
import { REMOTE_ORIGIN, type RemoteScope } from './relay-types.js';
import type { RemoteIdentity } from './credential-store.js';
import type { RemoteRendererQueue } from './renderer-queue.js';

const WRITE_COMMANDS = new Set([
  'set_selection',
  'add_text',
  'add_rectangle',
  'transform_artwork',
  'update_operation',
]);
export type RelayMessage = Record<string, unknown>;
export const object = (value: unknown): value is RelayMessage =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
export const validRemoteScopes = (value: unknown): value is RemoteScope[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 2 &&
  value.every((scope) => scope === 'read' || scope === 'edit') &&
  value.includes('read') &&
  new Set(value).size === value.length;

type Options = {
  readonly queue: RemoteRendererQueue;
  readonly onMessage: (message: RelayMessage) => void;
  readonly onConnection: (connected: boolean) => void;
  readonly canRequest: (clientId: string, scopes: RemoteScope[]) => boolean;
};
type Command = {
  requestId: string;
  clientId: string;
  scopes: RemoteScope[];
  name: KerfDeskMcpCommand;
  args: Record<string, unknown>;
};
function parseCommand(message: RelayMessage): Command | null {
  const request = message.command;
  if (
    !identifier(message.requestId) ||
    !identifier(message.clientId) ||
    !validRemoteScopes(message.scopes)
  )
    return null;
  if (
    !object(request) ||
    typeof request.name !== 'string' ||
    !Object.hasOwn(mcpInputSchemas, request.name) ||
    !object(request.args)
  )
    return null;
  const name = request.name as KerfDeskMcpCommand;
  const parsed = mcpInputSchemas[name].safeParse(request.args);
  if (!parsed.success || (WRITE_COMMANDS.has(name) && !message.scopes.includes('edit')))
    return null;
  return {
    requestId: message.requestId,
    clientId: message.clientId,
    scopes: message.scopes,
    name,
    args: parsed.data,
  };
}
function parseMessage(data: WebSocket.RawData): RelayMessage | null {
  try {
    const value: unknown = JSON.parse(data.toString());
    return object(value) && value.v === 1 && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Only the fixed first-party relay receives credentials. No remote caller selects a URL. */
class RemoteRelayClient {
  private socket: WebSocket | null = null;
  private identity: RemoteIdentity | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private generation = 0;
  private readonly commands = new Map<string, { controller: AbortController; clientId: string }>();
  constructor(private readonly options: Options) {}
  requestId = randomUUID;
  send(message: RelayMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ v: 1, ...message }));
    return true;
  }
  cancelRequests(): void {
    for (const item of this.commands.values()) item.controller.abort();
    this.commands.clear();
  }
  cancelClient(clientId: string): void {
    for (const item of this.commands.values())
      if (item.clientId === clientId) item.controller.abort();
  }
  close(): void {
    this.generation += 1;
    this.identity = null;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.cancelRequests();
    this.options.onConnection(false);
  }
  start(value: RemoteIdentity): void {
    this.close();
    this.identity = value;
    this.attempt = 0;
    void this.connect();
  }
  private schedule(): void {
    if (this.identity === null || !this.options.queue.ready()) return;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, wait);
    this.retry.unref();
  }
  private error(requestId: string, code: string): void {
    this.send({
      type: 'error',
      requestId,
      error: { code, message: 'The desktop request could not be completed.' },
    });
  }
  private invalidCommand(message: RelayMessage): void {
    if (identifier(message.requestId)) this.error(message.requestId, 'invalid_input');
  }
  private acceptsCommand(command: Command): boolean {
    return (
      !this.commands.has(command.requestId) &&
      this.commands.size < 32 &&
      this.options.canRequest(command.clientId, command.scopes)
    );
  }
  private canReply(
    generation: number,
    controller: AbortController,
    clientId: string,
    scopes: RemoteScope[],
  ): boolean {
    return (
      generation === this.generation &&
      !controller.signal.aborted &&
      this.options.canRequest(clientId, scopes)
    );
  }
  private async command(message: RelayMessage, generation: number): Promise<void> {
    const command = parseCommand(message);
    if (command === null) {
      this.invalidCommand(message);
      return;
    }
    const { requestId, clientId, scopes, name, args } = command;
    if (!this.acceptsCommand(command)) {
      this.error(requestId, 'unavailable');
      return;
    }
    const controller = new AbortController();
    this.commands.set(requestId, { controller, clientId });
    try {
      const raw = await this.options.queue.request(
        name,
        args,
        clientId,
        scopes.includes('edit'),
        controller.signal,
      );
      const result = mcpOutputSchemas[name].safeParse(raw);
      if (
        !result.success ||
        Buffer.byteLength(JSON.stringify(result.data), 'utf8') > MCP_MAX_RESULT_BYTES
      )
        throw new KerfDeskMcpError('failed');
      if (this.canReply(generation, controller, clientId, scopes))
        this.send({ type: 'result', requestId, result: result.data });
    } catch (error: unknown) {
      if (generation === this.generation) this.error(requestId, mcpErrorCode(error));
    } finally {
      if (this.commands.get(requestId)?.controller === controller) this.commands.delete(requestId);
    }
  }
  private receive(
    ws: WebSocket,
    generation: number,
    deviceId: string,
    data: WebSocket.RawData,
    binary: boolean,
  ): void {
    if (binary || generation !== this.generation || this.socket !== ws) return;
    const message = parseMessage(data);
    if (message === null) {
      ws.close(1008);
      return;
    }
    switch (message.type) {
      case 'connected':
        if (message.deviceId === deviceId) {
          this.attempt = 0;
          this.options.onConnection(true);
        }
        break;
      case 'command':
        void this.command(message, generation);
        break;
      case 'cancel':
        if (identifier(message.requestId)) this.commands.get(message.requestId)?.controller.abort();
        break;
      default:
        this.options.onMessage(message);
    }
  }
  private async connect(): Promise<void> {
    const saved = this.identity;
    const generation = this.generation;
    if (saved === null || !this.options.queue.ready()) return;
    try {
      const response = await fetch(`${REMOTE_ORIGIN}/api/desktop/register`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          deviceId: saved.deviceId,
          label: 'KerfDesk computer',
          ownerSecret: saved.ownerSecret,
        }),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('Registration unavailable');
      if (generation !== this.generation || this.identity === null || !this.options.queue.ready())
        return;
      const url = new URL('/api/desktop/connect', REMOTE_ORIGIN);
      url.protocol = 'wss:';
      url.searchParams.set('deviceId', saved.deviceId);
      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${saved.ownerSecret}` },
        maxPayload: MCP_MAX_RESULT_BYTES,
        handshakeTimeout: 10_000,
      });
      this.socket = ws;
      ws.on('error', () => undefined);
      ws.on('close', () => {
        if (generation !== this.generation || this.socket !== ws) return;
        this.socket = null;
        this.cancelRequests();
        this.options.onConnection(false);
        this.schedule();
      });
      ws.on('message', (data, binary) =>
        this.receive(ws, generation, saved.deviceId, data, binary),
      );
    } catch {
      if (generation === this.generation) {
        this.options.onConnection(false);
        this.schedule();
      }
    }
  }
}

export const createRemoteRelayClient = (options: Options) => new RemoteRelayClient(options);
