import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import { mcpErrorMessages, type KerfDeskMcpErrorCode } from '../../../electron/mcp/backend.js';
import {
  COMMAND_TIMEOUT_MS,
  MAX_BYTES,
  MAX_METADATA_BYTES,
  PAIR_TTL_MS,
  SESSION_TTL_MS,
  WRITE_COMMANDS,
  normalizedScopes,
  parseCommand,
  uuid,
  type GrantProps,
  type RemoteScope,
} from './protocol.js';
import { digest, json, pairingCode, sameDigest } from './security.js';
import { DeviceApprovals } from './approvals.js';
type OwnerAttachment = { role: 'desktop'; connectionId: string };
type Pending = {
  requestId: string;
  clientId: string;
  leaseId: string;
  scopes: RemoteScope;
  sessionDigest?: string;
  name: keyof typeof mcpOutputSchemas;
  connectionId: string;
  resolve: (value: CommandResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};
type CommandResponse = {
  result: Record<string, unknown> | null;
  error: { code: KerfDeskMcpErrorCode; message: string } | null;
};

const errorResult = (code: KerfDeskMcpErrorCode): CommandResponse => ({
  result: null,
  error: { code, message: mcpErrorMessages[code] },
});
const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const metadataBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
function parseEnvelope(message: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(message);
    return plainObject(value) && value.v === 1 && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Outbound desktop connection and ephemeral, bounded command exchanges. */
export class RemoteDevice extends DeviceApprovals {
  private readonly pending = new Map<string, Pending>();
  protected owner(): { socket: WebSocket; connectionId: string } | null {
    for (const socket of this.ctx.getWebSockets('desktop')) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const value: unknown = socket.deserializeAttachment();
      if (plainObject(value) && value.role === 'desktop' && typeof value.connectionId === 'string')
        return { socket, connectionId: value.connectionId };
    }
    return null;
  }

  protected send(value: unknown): boolean {
    const owner = this.owner();
    if (owner === null) return false;
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) return false;
    try {
      owner.socket.send(encoded);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ctx.blockConcurrencyWhile(() => this.pruneExpired());
    // The Worker sends only a digest to this private DO route. No credentials in its URL.
    if (
      new URL(request.url).pathname !== '/owner' ||
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
      this.state === null ||
      !sameDigest(this.state.ownerDigest, request.headers.get('X-Owner-Digest') ?? '')
    )
      return json({ error: 'unavailable' }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    for (const old of this.ctx.getWebSockets('desktop')) {
      this.cancelConnection(old, 'unavailable');
      try {
        old.close(1000, 'Replaced');
      } catch {
        /* The old transport is already closed. */
      }
    }
    const attachment: OwnerAttachment = { role: 'desktop', connectionId: crypto.randomUUID() };
    this.ctx.acceptWebSocket(server, ['desktop']);
    server.serializeAttachment(attachment);
    server.send(
      JSON.stringify({ v: 1, type: 'connected', deviceId: request.headers.get('X-Device-Id') }),
    );
    this.sendClients();
    for (const item of this.state.clients) {
      if (item.status === 'pending' && item.claimExpiresAt > Date.now()) this.sendPairRequest(item);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  protected revokePending(clientId: string): void {
    for (const item of [...this.pending.values()])
      if (item.clientId === clientId) this.finish(item, errorResult('cancelled'), true);
  }
  private finish(item: Pending, result: CommandResponse, cancelDesktop = false): void {
    if (this.pending.get(item.requestId) !== item) return;
    this.pending.delete(item.requestId);
    clearTimeout(item.timer);
    if (cancelDesktop && this.owner()?.connectionId === item.connectionId)
      this.send({ v: 1, type: 'cancel', requestId: item.requestId });
    item.resolve(result);
  }

  private cancelConnection(socket: WebSocket, code: KerfDeskMcpErrorCode): void {
    const value: unknown = socket.deserializeAttachment();
    if (!plainObject(value)) return;
    for (const item of [...this.pending.values()])
      if (item.connectionId === value.connectionId) this.finish(item, errorResult(code));
  }

  async cancelCommand(clientId: string, requestId: string): Promise<void> {
    const item = this.pending.get(requestId);
    if (item?.clientId === clientId) this.finish(item, errorResult('cancelled'), true);
  }

  async runCommand(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    commandJson: string,
    sessionDigest?: string,
  ): Promise<string> {
    if (new TextEncoder().encode(commandJson).byteLength > MAX_BYTES)
      return JSON.stringify(errorResult('invalid_input'));
    let command: unknown;
    try {
      command = JSON.parse(commandJson);
    } catch {
      return JSON.stringify(errorResult('invalid_input'));
    }
    return JSON.stringify(await this.command(props, scopes, requestId, command, sessionDigest));
  }

  private async command(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    command: unknown,
    sessionDigest?: string,
  ): Promise<CommandResponse> {
    const parsed = parseCommand(command);
    if (!parsed || !uuid.safeParse(requestId).success) return errorResult('invalid_input');
    if (
      !this.isAuthorized(props, scopes) ||
      (WRITE_COMMANDS.has(parsed.name) && !scopes.includes('edit'))
    )
      return errorResult('unavailable');
    if (sessionDigest && this.sessionInfo(props.clientId, sessionDigest).status !== 'approved')
      return errorResult('unavailable');
    const owner = this.owner();
    if (!owner || this.pending.size >= 32 || this.pending.has(requestId))
      return errorResult('unavailable');
    return new Promise((resolve) => {
      const item: Pending = {
        requestId,
        clientId: props.clientId,
        leaseId: props.leaseId,
        scopes,
        name: parsed.name,
        sessionDigest,
        connectionId: owner.connectionId,
        resolve,
        timer: setTimeout(() => {
          this.finish(item, errorResult('unavailable'), true);
        }, COMMAND_TIMEOUT_MS),
      };
      this.pending.set(requestId, item);
      if (
        !this.send({
          v: 1,
          type: 'command',
          requestId,
          clientId: props.clientId,
          scopes,
          command: parsed,
        })
      )
        this.finish(item, errorResult('unavailable'));
    });
  }

  private handleResult(value: Record<string, unknown>): void {
    if (typeof value.requestId !== 'string') return;
    const item = this.pending.get(value.requestId);
    if (!item || item.connectionId !== this.owner()?.connectionId) return;
    // No await between the final lease check and resolving: revocation cannot interleave.
    if (!this.resultAuthorized(item)) {
      this.finish(item, errorResult('cancelled'), true);
      return;
    }
    if (value.type === 'error') {
      const supplied = plainObject(value.error) ? value.error.code : undefined;
      const code =
        typeof supplied === 'string' && Object.hasOwn(mcpErrorMessages, supplied)
          ? (supplied as KerfDeskMcpErrorCode)
          : 'failed';
      this.finish(item, errorResult(code));
    } else {
      const parsed = mcpOutputSchemas[item.name].safeParse(value.result);
      this.finish(
        item,
        parsed.success ? { result: parsed.data, error: null } : errorResult('failed'),
      );
    }
  }
  private resultAuthorized(item: Pending): boolean {
    const props = { deviceId: '', clientId: item.clientId, leaseId: item.leaseId };
    return (
      this.isAuthorized(props, item.scopes) &&
      (!item.sessionDigest ||
        this.sessionInfo(item.clientId, item.sessionDigest).status === 'approved')
    );
  }
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
    this.send({ v: 1, type: 'pair.offer', requestId, code, expiresAt: this.state.offer.expiresAt });
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
  private async handleMetadata(value: Record<string, unknown>): Promise<void> {
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
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (
      this.owner()?.socket !== socket ||
      typeof message !== 'string' ||
      new TextEncoder().encode(message).byteLength > MAX_BYTES
    ) {
      this.cancelConnection(socket, 'failed');
      try {
        socket.close(1008, 'Invalid message');
      } catch {
        /* Already closed. */
      }
      return;
    }
    const value = parseEnvelope(message);
    if (value === null) {
      socket.close(1008, 'Invalid message');
      return;
    }
    if (value.type === 'result' || value.type === 'error') {
      this.handleResult(value);
      return;
    }
    if (metadataBytes(value) > MAX_METADATA_BYTES) {
      socket.close(1008, 'Invalid metadata');
      return;
    }
    await this.ctx.blockConcurrencyWhile(async () => {
      if (!this.state || this.owner()?.socket !== socket) return;
      await this.pruneExpired();
      await this.handleMetadata(value);
    });
  }
  webSocketClose(socket: WebSocket, code: number): void {
    this.cancelConnection(socket, 'unavailable');
    try {
      socket.close(code, 'Disconnected');
    } catch {
      /* Already closed. */
    }
  }
  webSocketError(socket: WebSocket): void {
    this.cancelConnection(socket, 'unavailable');
  }
}
