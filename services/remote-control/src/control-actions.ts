import { z } from 'zod';
import { mcpControlOperationSchema } from '../../../electron/mcp/machine-schemas.js';
import {
  MCP_PRIORITY_COMMANDS,
  type KerfDeskMcpCommand,
} from '../../../electron/mcp/input-schemas.js';
import { digest } from './security.js';
import type { GrantProps } from './protocol.js';

const PREFIX = 'control-action:v1:';
const COUNT_PREFIX = 'control-count:v1:';
export const MAX_ORDINARY_CONTROL_ACTIONS = 4096;
export const RESERVED_ABORT_ACTIONS = 256;
export const MAX_CONTROL_ACTIONS = MAX_ORDINARY_CONTROL_ACTIONS + RESERVED_ABORT_ACTIONS;
const countSchema = z.object({
  leaseId: z.uuid(),
  ordinary: z.number().int().min(0).max(MAX_ORDINARY_CONTROL_ACTIONS),
  abort: z.number().int().min(0).max(RESERVED_ABORT_ACTIONS),
});
/**
 * Desktop answers that only come before anything reaches the machine: the desktop
 * refuses these before it owns an operation. ADR-569 keeps "unconfirmed" for a lost
 * result, so these stay definite refusals (rolling audit 2026-10-21 01-P2-3).
 */
const DEFINITE_REFUSALS = ['stale_revision', 'invalid_input', 'busy'] as const;
export type DefiniteRefusal = (typeof DEFINITE_REFUSALS)[number];
export function isDefiniteRefusal(code: string): code is DefiniteRefusal {
  return (DEFINITE_REFUSALS as readonly string[]).includes(code);
}
const recordSchema = z.object({
  leaseId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operation: mcpControlOperationSchema.omit({ review: true }),
  refusal: z.enum(DEFINITE_REFUSALS).optional(),
});
type Admission =
  | { state: 'fresh'; operationId: string }
  | { state: 'replay'; result: Record<string, unknown> }
  | { state: 'refused'; code: DefiniteRefusal }
  | { state: 'conflict' | 'limit' | 'unavailable' };

const KINDS: Record<string, z.output<typeof mcpControlOperationSchema>['kind']> = {
  jog_machine: 'jog',
  frame_job: 'frame',
  abort_job: 'abort',
  connect_machine: 'connect',
  disconnect_machine: 'disconnect',
  home_machine: 'home',
  set_work_origin: 'origin',
  pause_job: 'pause',
  resume_job: 'resume',
  jog_hold_start: 'hold',
  jog_hold_stop: 'hold',
};
function operationKind(command: string): z.output<typeof mcpControlOperationSchema>['kind'] {
  return KINDS[command] ?? 'job';
}
function usesAbortReserve(
  command: KerfDeskMcpCommand,
  counts: z.output<typeof countSchema> | null,
): boolean {
  // Routine hold releases spend ordinary capacity; preserve the Abort reserve until needed.
  return (
    command === 'abort_job' ||
    (MCP_PRIORITY_COMMANDS.has(command) && counts?.ordinary === MAX_ORDINARY_CONTROL_ACTIONS)
  );
}
type SavedOperation = z.output<typeof recordSchema>['operation'];
function unconfirmedReceipt(
  requestId: string,
  operation: SavedOperation | null,
): Record<string, unknown> {
  return {
    revision: operation?.revision ?? 'unconfirmed',
    operation: {
      operationId: requestId,
      kind: operation?.kind ?? 'job',
      state: 'unknown',
      revision: operation?.revision ?? 'unconfirmed',
      committed: operation?.committed === true ? true : null,
      message:
        'This action outcome is unconfirmed. Check the operation and machine status before sending another action. Do not automatically repeat it with a new ID.',
    },
  };
}
function refusedReceipt(operation: SavedOperation): Record<string, unknown> {
  return {
    revision: operation.revision,
    operation: {
      ...operation,
      state: 'failed',
      committed: false,
      message:
        'The PC refused this action before sending anything to the machine. Read the status again before a new request.',
    },
  };
}
const clientPrefix = (clientId: string) => `${PREFIX}${clientId}:`;
const keyFor = (clientId: string, requestId: string) => `${clientPrefix(clientId)}${requestId}`;

/** Durable metadata only. Admitted IDs are never evicted while their pairing lease can be used. */
export class ControlActions {
  constructor(private readonly storage: DurableObjectStorage) {}

  async reserve(
    props: GrantProps,
    command: KerfDeskMcpCommand,
    args: Record<string, unknown>,
    authorized: () => boolean,
  ): Promise<Admission> {
    const requestId = z.uuid().parse(args.requestId);
    const fingerprint = await digest(JSON.stringify({ command, args }));
    const result = this.storage.transactionSync((): Admission => {
      if (!authorized()) return { state: 'unavailable' };
      const key = keyFor(props.clientId, requestId);
      const existing = recordSchema.safeParse(this.storage.kv.get(key));
      if (existing.success) return this.readmit(existing.data, props, requestId, fingerprint);
      // Corrupt existing metadata must not re-open a previously admitted ID.
      if (this.storage.kv.get(key) !== undefined) return { state: 'conflict' };
      const counts = this.counts(props);
      const priority = usesAbortReserve(command, counts);
      if (
        !counts ||
        (priority
          ? counts.abort >= RESERVED_ABORT_ACTIONS
          : counts.ordinary >= MAX_ORDINARY_CONTROL_ACTIONS)
      )
        return { state: 'limit' };
      this.storage.kv.put(`${COUNT_PREFIX}${props.clientId}`, {
        ...counts,
        ordinary: counts.ordinary + (priority ? 0 : 1),
        abort: counts.abort + (priority ? 1 : 0),
      });
      this.storage.kv.put(key, {
        leaseId: props.leaseId,
        fingerprint,
        operation: {
          operationId: requestId,
          kind: operationKind(command),
          state: 'accepted',
          revision:
            typeof args.expectedRevision === 'string' ? args.expectedRevision : 'unconfirmed',
          committed: false,
        },
      });
      return { state: 'fresh', operationId: requestId };
    });
    // The metadata commit must precede any motion request sent to the desktop.
    await this.storage.sync();
    return result;
  }

  /** A used ID is never dispatched again: a refusal stays a refusal, anything else unconfirmed. */
  private readmit(
    existing: z.output<typeof recordSchema>,
    props: GrantProps,
    requestId: string,
    fingerprint: string,
  ): Admission {
    if (existing.leaseId !== props.leaseId || existing.fingerprint !== fingerprint)
      return { state: 'conflict' };
    if (existing.refusal !== undefined) return { state: 'refused', code: existing.refusal };
    return { state: 'replay', result: this.unknown(props, requestId) };
  }

  private counts(props: GrantProps): z.output<typeof countSchema> | null {
    const raw = this.storage.kv.get(`${COUNT_PREFIX}${props.clientId}`);
    const parsed = countSchema.safeParse(raw);
    if (parsed.success) return parsed.data.leaseId === props.leaseId ? parsed.data : null;
    if (
      raw !== undefined ||
      Array.from(this.storage.kv.list({ prefix: clientPrefix(props.clientId), limit: 1 })).length >
        0
    )
      return null;
    return { leaseId: props.leaseId, ordinary: 0, abort: 0 };
  }

  /** The ledger's own receipt, used whenever no desktop answer can be trusted. */
  unknown(props: GrantProps, requestId: string): Record<string, unknown> {
    const saved = recordSchema.safeParse(this.storage.kv.get(keyFor(props.clientId, requestId)));
    if (!saved.success || saved.data.leaseId !== props.leaseId)
      return unconfirmedReceipt(requestId, null);
    return saved.data.refusal === undefined
      ? unconfirmedReceipt(requestId, saved.data.operation)
      : refusedReceipt(saved.data.operation);
  }

  /** Tombstone: the ID stays used, and a replay gets the same refusal, never "unconfirmed". */
  refuse(props: GrantProps, requestId: string, code: DefiniteRefusal): void {
    const key = keyFor(props.clientId, requestId);
    const saved = recordSchema.safeParse(this.storage.kv.get(key));
    if (
      !saved.success ||
      saved.data.leaseId !== props.leaseId ||
      saved.data.operation.committed !== false
    )
      return;
    this.storage.kv.put(key, {
      ...saved.data,
      operation: { ...saved.data.operation, state: 'failed' },
      refusal: code,
    });
  }

  acknowledge(props: GrantProps, requestId: string, value: unknown): void {
    const parsed = mcpControlOperationSchema.safeParse(value);
    if (!parsed.success || parsed.data.operationId !== requestId) return;
    const key = keyFor(props.clientId, requestId);
    const saved = recordSchema.safeParse(this.storage.kv.get(key));
    if (!saved.success || saved.data.leaseId !== props.leaseId || saved.data.refusal) return;
    // Never persist review strings, artwork, G-code or arbitrary desktop error messages.
    const { operationId, kind, state, revision, committed } = parsed.data;
    this.storage.kv.put(key, {
      ...saved.data,
      operation: {
        operationId,
        kind,
        state,
        revision,
        committed: saved.data.operation.committed === true ? true : committed,
      },
    });
  }

  lookup(
    props: GrantProps,
    requestId: string,
    result: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (result === null) return this.unknown(props, requestId);
    const operation = mcpControlOperationSchema.safeParse(result.operation);
    if (
      !operation.success ||
      operation.data.operationId !== requestId ||
      operation.data.state === 'unknown'
    )
      return this.unknown(props, requestId);
    this.acknowledge(props, requestId, operation.data);
    return result;
  }

  revoke(clientId: string): void {
    for (const [key] of this.storage.kv.list({
      prefix: clientPrefix(clientId),
      limit: MAX_CONTROL_ACTIONS,
    }))
      this.storage.kv.delete(key);
    this.storage.kv.delete(`${COUNT_PREFIX}${clientId}`);
  }
}
