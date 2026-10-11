import { mcpErrorMessages, type KerfDeskMcpErrorCode } from '../../../electron/mcp/backend.js';
import { MCP_PHONE_ONLY_COMMANDS } from '../../../electron/mcp/input-schemas.js';
import { json } from './security.js';
import {
  MAX_BYTES,
  uuid,
  type GrantProps,
  type McpReservation,
  type RemoteScope,
  type parseCommand,
} from './protocol.js';
import { parseEnvelope } from './device-envelope.js';
import { DevicePairing } from './pairing.js';
import { LiveChannel } from './live.js';
import { PushAlerts, type StoredSubscription } from './push.js';
import type { ControlActions } from './control-actions.js';

export type CommandResponse = {
  result: Record<string, unknown> | null;
  error: { code: KerfDeskMcpErrorCode; message: string } | null;
};
export const errorResult = (code: KerfDeskMcpErrorCode): CommandResponse => ({
  result: null,
  error: { code, message: mcpErrorMessages[code] },
});
type Parsed = NonNullable<ReturnType<typeof parseCommand>>;
export function controlLookupId(parsed: Parsed): string | undefined {
  return parsed.name === 'get_control_operation' && 'operationId' in parsed.args
    ? parsed.args.operationId
    : undefined;
}
export function unavailableResponse(
  actions: ControlActions,
  props: GrantProps,
  receiptId: string | undefined,
): CommandResponse {
  return receiptId
    ? { result: actions.unknown(props, receiptId), error: null }
    : errorResult('unavailable');
}

/** ADR-582/583/585: phone sockets, change fan-out, relay-answered waits and job alerts. */
export abstract class LiveDevice extends DevicePairing {
  protected readonly pushAlerts = new PushAlerts(this.ctx.storage, this.env);
  protected readonly live = new LiveChannel(this.ctx, {
    owner: () => this.owner(),
    sendDesktop: (value) => this.send(value),
    allowed: (clientId, sessionDigest, scope) => this.phoneAllowed(clientId, sessionDigest, scope),
  });

  /** A pending command's grant (and phone session) must still be current when its result lands. */
  protected resultAuthorized(item: {
    clientId: string;
    leaseId: string;
    scopes: RemoteScope;
    sessionDigest?: string;
  }): boolean {
    const props = { deviceId: '', clientId: item.clientId, leaseId: item.leaseId };
    return (
      this.isAuthorized(props, item.scopes) &&
      (!item.sessionDigest ||
        this.sessionInfo(item.clientId, item.sessionDigest).status === 'approved')
    );
  }

  /** Only the current owner's bounded JSON envelopes are accepted. */
  protected ownerEnvelope(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Record<string, unknown> | null {
    return this.owner()?.socket === socket &&
      typeof message === 'string' &&
      new TextEncoder().encode(message).byteLength <= MAX_BYTES
      ? parseEnvelope(message)
      : null;
  }

  protected phoneAllowed(
    clientId: string,
    sessionDigest: string,
    scope: 'read' | 'control',
  ): boolean {
    const info = this.sessionInfo(clientId, sessionDigest);
    return info.status === 'approved' && info.client.scopes.includes(scope);
  }

  /** Phone live socket: the Worker already checked the exact Origin and cookie session. */
  protected acceptClientSocket(request: Request): Response {
    const clientId = request.headers.get('X-Client-Id') ?? '';
    const sessionDigest = request.headers.get('X-Session-Digest') ?? '';
    if (
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
      !uuid.safeParse(clientId).success ||
      !this.phoneAllowed(clientId, sessionDigest, 'read')
    )
      return json({ error: 'unavailable' }, 401);
    return this.live.acceptPhone(clientId, sessionDigest);
  }

  /** Stores this approved phone's single push subscription; null removes it. */
  async savePush(
    clientId: string,
    sessionDigest: string,
    subscription: StoredSubscription | null,
  ): Promise<boolean> {
    return (
      this.phoneAllowed(clientId, sessionDigest, 'read') &&
      this.pushAlerts.save(clientId, subscription)
    );
  }

  protected releaseLiveClient(clientId: string): void {
    this.pushAlerts.remove(clientId);
    this.live.closeClient(clientId);
  }

  /**
   * Commands the relay answers or refuses before contacting the PC. `wait_for_change` resolves
   * from the desktop's change counters; held jogs need a phone with a live socket.
   */
  protected async liveCommand(
    parsed: Parsed,
    requestId: string,
    props: GrantProps,
    sessionDigest: string | undefined,
    mcpReservation: McpReservation | undefined,
    authorized: () => boolean,
  ): Promise<CommandResponse | null> {
    if (parsed.name === 'wait_for_change') {
      const result = await this.live.wait(requestId, parsed.args as Record<string, never>);
      return authorized() ? { result, error: null } : errorResult('cancelled');
    }
    if (!MCP_PHONE_ONLY_COMMANDS.has(parsed.name)) return null;
    const phone = sessionDigest !== undefined && mcpReservation === undefined;
    if (!phone || (parsed.name === 'jog_hold_start' && !this.live.hasPhone(props.clientId)))
      return errorResult('unavailable');
    return null;
  }

  /** Desktop change counters and kind-only events. Returns true when handled. */
  protected liveMessage(socket: WebSocket, value: Record<string, unknown>): boolean {
    if (value.type === 'changed') {
      this.live.observe(socket, value);
      return true;
    }
    if (value.type !== 'event') return false;
    if (this.live.event(value.kind)) this.ctx.waitUntil(this.notify(value.kind as string));
    return true;
  }

  /** ADR-583 alerts; a no-op unless the maintainer configured VAPID secrets. */
  private async notify(kind: string): Promise<void> {
    await this.pushAlerts.deliver(kind, (clientId) =>
      Boolean(
        this.state?.clients.some((item) => item.id === clientId && item.status === 'approved'),
      ),
    );
  }
}
