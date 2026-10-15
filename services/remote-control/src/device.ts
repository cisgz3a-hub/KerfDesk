import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import { mcpErrorMessages, type KerfDeskMcpErrorCode } from '../../../electron/mcp/backend.js';
import {
  COMMAND_TIMEOUT_MS,
  MAX_BYTES,
  MAX_METADATA_BYTES,
  mcpCommandScope,
  parseCommand,
  uuid,
  type GrantProps,
  type McpReservation,
  type RemoteScope,
} from './protocol.js';
import { json, sameDigest } from './security.js';
import { McpRequests } from './mcp-requests.js';
import { ControlActions } from './control-actions.js';
import { plainObject, metadataBytes } from './device-envelope.js';
import { isPhoneAttachment, type WaitArgs } from './live.js';
import {
  LiveDevice,
  admitControl,
  controlLookupId,
  errorResult,
  unavailableResponse,
  type CommandResponse,
} from './device-live.js';
import { MCP_PRIORITY_COMMANDS } from '../../../electron/mcp/input-schemas.js';
type OwnerAttachment = {
  role: 'desktop';
  connectionId: string;
  revision?: string;
  machineSeq?: number;
};
type Pending = {
  requestId: string;
  clientId: string;
  leaseId: string;
  scopes: RemoteScope;
  sessionDigest?: string;
  mcpReservation?: McpReservation;
  name: keyof typeof mcpOutputSchemas;
  connectionId: string | null;
  controlId?: string;
  controlLookupId?: string;
  resolve: (value: CommandResponse) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Outbound desktop connection, bounded command exchanges and durable motion admission. */
export class RemoteDevice extends LiveDevice {
  private readonly pending = new Map<string, Pending>();
  private readonly mcpRequests = new McpRequests();
  private readonly controlActions = new ControlActions(this.ctx.storage);
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
    const path = new URL(request.url).pathname;
    if (path === '/client') return this.acceptClientSocket(request);
    return path === '/owner' ? this.acceptOwner(request) : json({ error: 'unavailable' }, 401);
  }

  private acceptOwner(request: Request): Response {
    // The Worker sends only a digest to this private DO route. No credentials in its URL.
    if (
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
    this.live.desktopOnline(true);
    return new Response(null, { status: 101, webSocket: client });
  }

  protected revokePending(clientId: string): void {
    this.releaseLiveClient(clientId);
    this.controlActions.revoke(clientId);
    this.mcpRequests.revoke(clientId);
    for (const item of [...this.pending.values()])
      if (item.clientId === clientId) this.finish(item, errorResult('cancelled'), true);
  }
  private finish(item: Pending, result: CommandResponse, cancelDesktop = false): void {
    if (this.pending.get(item.requestId) !== item) return;
    this.pending.delete(item.requestId);
    if (item.mcpReservation) this.mcpRequests.detach(item.mcpReservation, item.requestId);
    clearTimeout(item.timer);
    if (item.name === 'wait_for_change') this.live.cancelWait(item.requestId);
    else if (cancelDesktop && this.owner()?.connectionId === item.connectionId)
      this.send({ v: 1, type: 'cancel', requestId: item.requestId });
    item.resolve(this.controlResponse(item, result));
  }

  private controlResponse(item: Pending, result: CommandResponse): CommandResponse {
    if (!this.resultAuthorized(item)) return result;
    const props = { deviceId: '', clientId: item.clientId, leaseId: item.leaseId };
    if (item.controlId) {
      const operation = result.result?.operation;
      if (plainObject(operation) && operation.operationId === item.controlId)
        this.controlActions.acknowledge(props, item.controlId, operation);
      else result = { result: this.controlActions.unknown(props, item.controlId), error: null };
    }
    if (item.controlLookupId)
      result = {
        result: this.controlActions.lookup(props, item.controlLookupId, result.result),
        error: null,
      };
    return result;
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

  async beginMcpRequest(
    props: GrantProps,
    scopes: RemoteScope,
    key: string,
    priority = false,
  ): Promise<string | null> {
    return this.isAuthorized(props, scopes)
      ? this.mcpRequests.begin(
          key,
          props,
          this.owner()?.connectionId ?? null,
          priority && scopes.includes('control'),
        )
      : null;
  }

  async cancelMcpRequest(props: GrantProps, scopes: RemoteScope, key: string): Promise<void> {
    if (this.isAuthorized(props, scopes)) this.mcpRequests.cancel(key, props);
  }

  async endMcpRequest(props: GrantProps, reservation: McpReservation): Promise<void> {
    this.mcpRequests.end(reservation, props);
  }

  async runCommand(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    commandJson: string,
    sessionDigest?: string,
    mcpReservation?: McpReservation,
  ): Promise<string> {
    if (new TextEncoder().encode(commandJson).byteLength > MAX_BYTES)
      return JSON.stringify(errorResult('invalid_input'));
    let command: unknown;
    try {
      command = JSON.parse(commandJson);
    } catch {
      return JSON.stringify(errorResult('invalid_input'));
    }
    return JSON.stringify(
      await this.command(props, scopes, requestId, command, sessionDigest, mcpReservation),
    );
  }

  private async command(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    command: unknown,
    sessionDigest?: string,
    mcpReservation?: McpReservation,
  ): Promise<CommandResponse> {
    const parsed = parseCommand(command);
    if (!parsed || !uuid.safeParse(requestId).success) return errorResult('invalid_input');
    if (!this.commandAuthorized(props, scopes, parsed, sessionDigest))
      return errorResult('unavailable');
    const relayed = this.liveCommand(parsed, props, sessionDigest, mcpReservation);
    if (relayed !== null) return relayed;
    const lookupId = controlLookupId(parsed);
    const priority = MCP_PRIORITY_COMMANDS.has(parsed.name);
    if (this.pending.size >= (priority ? 36 : 32) || this.pending.has(requestId))
      return unavailableResponse(this.controlActions, props, lookupId);
    return this.dispatch(
      props,
      scopes,
      requestId,
      parsed,
      this.owner()?.connectionId ?? null,
      sessionDigest,
      mcpReservation,
      lookupId,
    );
  }

  private commandAuthorized(
    props: GrantProps,
    scopes: RemoteScope,
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    sessionDigest?: string,
  ): boolean {
    return (
      this.isAuthorized(props, scopes) &&
      scopes.includes(mcpCommandScope(parsed.name)) &&
      (!sessionDigest || this.sessionInfo(props.clientId, sessionDigest).status === 'approved')
    );
  }

  private dispatch(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    connectionId: string | null,
    sessionDigest?: string,
    mcpReservation?: McpReservation,
    controlLookupId?: string,
  ): Promise<CommandResponse> {
    return new Promise((resolve) => {
      const item: Pending = {
        requestId,
        clientId: props.clientId,
        leaseId: props.leaseId,
        scopes,
        name: parsed.name,
        sessionDigest,
        mcpReservation,
        connectionId,
        controlLookupId,
        resolve,
        timer: setTimeout(() => {
          this.finish(item, errorResult('unavailable'), true);
        }, COMMAND_TIMEOUT_MS),
      };
      if (
        mcpReservation &&
        !this.mcpRequests.attach(mcpReservation, props, connectionId, requestId, (code) =>
          this.finish(item, errorResult(code), true),
        )
      ) {
        clearTimeout(item.timer);
        resolve(errorResult('cancelled'));
        return;
      }
      this.pending.set(requestId, item);
      void this.executeCommand(item, props, parsed).catch(() =>
        this.finish(item, errorResult('unavailable'), true),
      );
    });
  }

  /** Track cancellation before any asynchronous ledger admission or relay-only wait. */
  private async executeCommand(
    item: Pending,
    props: GrantProps,
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
  ): Promise<void> {
    const active = () => this.pending.get(item.requestId) === item && this.resultAuthorized(item);
    if (parsed.name === 'wait_for_change') {
      const result = await this.live.wait(item.requestId, parsed.args as WaitArgs);
      this.finish(item, active() ? { result, error: null } : errorResult('cancelled'));
      return;
    }
    const control = await admitControl(this.controlActions, props, parsed, active);
    if (!active()) {
      this.finish(item, errorResult('cancelled'), true);
      return;
    }
    item.controlId = control.controlId;
    if (control.response) this.finish(item, control.response);
    else if (
      this.owner()?.connectionId !== item.connectionId ||
      !this.send({
        v: 1,
        type: 'command',
        requestId: item.requestId,
        clientId: item.clientId,
        scopes: item.scopes,
        command: parsed,
      })
    )
      this.finish(item, errorResult('unavailable'));
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

  /** Anything but the owner's bounded JSON closes the desktop connection. */
  private desktopEnvelope(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Record<string, unknown> | null {
    const value = this.ownerEnvelope(socket, message);
    if (value !== null) return value;
    this.cancelConnection(socket, 'failed');
    try {
      socket.close(1008, 'Invalid message');
    } catch {
      /* Already closed. */
    }
    return null;
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (isPhoneAttachment(socket.deserializeAttachment())) {
      this.live.phoneMessage(socket, message);
      return;
    }
    const value = this.desktopEnvelope(socket, message);
    if (value === null) return;
    if (value.type === 'result' || value.type === 'error') {
      this.handleResult(value);
      return;
    }
    if (this.liveMessage(socket, value)) return;
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
    if (isPhoneAttachment(socket.deserializeAttachment())) this.live.phoneClosed(socket);
    else {
      this.cancelConnection(socket, 'unavailable');
      if (this.owner() === null) this.live.desktopOnline(false);
    }
    try {
      socket.close(code, 'Disconnected');
    } catch {
      /* Already closed. */
    }
  }
  webSocketError(socket: WebSocket): void {
    if (isPhoneAttachment(socket.deserializeAttachment())) this.live.phoneClosed(socket);
    else this.cancelConnection(socket, 'unavailable');
  }
}
