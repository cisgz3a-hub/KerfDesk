import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import { mcpErrorMessages, type KerfDeskMcpErrorCode } from '../../../electron/mcp/backend.js';
import {
  COMMAND_TIMEOUT_MS,
  MAX_BYTES,
  MAX_METADATA_BYTES,
  CONTROL_COMMANDS,
  mcpCommandScope,
  parseCommand,
  uuid,
  type GrantProps,
  type McpReservation,
  type RemoteScope,
} from './protocol.js';
import { json, sameDigest } from './security.js';
import { DevicePairing } from './pairing.js';
import { McpRequests } from './mcp-requests.js';
import { ControlActions } from './control-actions.js';
import { plainObject, metadataBytes, parseEnvelope } from './device-envelope.js';
type OwnerAttachment = { role: 'desktop'; connectionId: string };
type Pending = {
  requestId: string;
  clientId: string;
  leaseId: string;
  scopes: RemoteScope;
  sessionDigest?: string;
  mcpReservation?: McpReservation;
  name: keyof typeof mcpOutputSchemas;
  connectionId: string;
  controlId?: string;
  controlLookupId?: string;
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
function controlLookupId(parsed: NonNullable<ReturnType<typeof parseCommand>>): string | undefined {
  return parsed.name === 'get_control_operation' && 'operationId' in parsed.args
    ? parsed.args.operationId
    : undefined;
}
function unavailableResponse(
  actions: ControlActions,
  props: GrantProps,
  receiptId: string | undefined,
): CommandResponse {
  return receiptId
    ? { result: actions.unknown(props, receiptId), error: null }
    : errorResult('unavailable');
}

/** Outbound desktop connection, bounded command exchanges and durable motion admission. */
export class RemoteDevice extends DevicePairing {
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
    if (cancelDesktop && this.owner()?.connectionId === item.connectionId)
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
    const control = await this.admitControl(props, scopes, parsed, sessionDigest);
    if (!this.commandAuthorized(props, scopes, parsed, sessionDigest))
      return errorResult('cancelled');
    if (control.response) return control.response;
    const controlId = control.controlId;
    const lookupId = controlLookupId(parsed);
    const owner = this.owner();
    const priority = parsed.name === 'abort_job';
    if (!owner || this.pending.size >= (priority ? 36 : 32) || this.pending.has(requestId))
      return unavailableResponse(this.controlActions, props, controlId ?? lookupId);
    return this.dispatch(
      props,
      scopes,
      requestId,
      parsed,
      owner.connectionId,
      sessionDigest,
      mcpReservation,
      controlId,
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

  private async admitControl(
    props: GrantProps,
    scopes: RemoteScope,
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    sessionDigest?: string,
  ): Promise<{ controlId?: string; response?: CommandResponse }> {
    if (!CONTROL_COMMANDS.has(parsed.name)) return {};
    const admission = await this.controlActions.reserve(props, parsed.name, parsed.args, () =>
      this.commandAuthorized(props, scopes, parsed, sessionDigest),
    );
    if (!this.commandAuthorized(props, scopes, parsed, sessionDigest))
      return { response: errorResult('cancelled') };
    if (admission.state === 'fresh') return { controlId: admission.operationId };
    if (admission.state === 'replay')
      return { response: { result: admission.result, error: null } };
    const code =
      admission.state === 'conflict'
        ? 'invalid_input'
        : admission.state === 'limit'
          ? 'control_limit'
          : 'unavailable';
    return { response: errorResult(code) };
  }

  private dispatch(
    props: GrantProps,
    scopes: RemoteScope,
    requestId: string,
    parsed: NonNullable<ReturnType<typeof parseCommand>>,
    connectionId: string,
    sessionDigest?: string,
    mcpReservation?: McpReservation,
    controlId?: string,
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
        controlId,
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
