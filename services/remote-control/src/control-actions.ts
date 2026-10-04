import { z } from 'zod';
import { mcpControlOperationSchema } from '../../../electron/mcp/machine-schemas.js';
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
const recordSchema = z.object({
  leaseId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  operation: mcpControlOperationSchema.omit({ review: true }),
});
type Admission =
  | { state: 'fresh'; operationId: string }
  | { state: 'replay'; result: Record<string, unknown> }
  | { state: 'conflict' | 'limit' | 'unavailable' };

function operationKind(command: string): 'jog' | 'frame' | 'job' | 'abort' {
  if (command === 'jog_machine') return 'jog';
  if (command === 'frame_job') return 'frame';
  return command === 'abort_job' ? 'abort' : 'job';
}
const clientPrefix = (clientId: string) => `${PREFIX}${clientId}:`;
const keyFor = (clientId: string, requestId: string) => `${clientPrefix(clientId)}${requestId}`;

/** Durable metadata only. Admitted IDs are never evicted while their pairing lease can be used. */
export class ControlActions {
  constructor(private readonly storage: DurableObjectStorage) {}

  async reserve(
    props: GrantProps,
    command: string,
    args: Record<string, unknown>,
    authorized: () => boolean,
  ): Promise<Admission> {
    const requestId = z.uuid().parse(args.requestId);
    const fingerprint = await digest(JSON.stringify({ command, args }));
    const result = this.storage.transactionSync((): Admission => {
      if (!authorized()) return { state: 'unavailable' };
      const key = keyFor(props.clientId, requestId);
      const existing = recordSchema.safeParse(this.storage.kv.get(key));
      if (existing.success) {
        if (existing.data.leaseId !== props.leaseId || existing.data.fingerprint !== fingerprint)
          return { state: 'conflict' };
        return { state: 'replay', result: this.unknown(props, requestId) };
      }
      // Corrupt existing metadata must not re-open a previously admitted ID.
      if (this.storage.kv.get(key) !== undefined) return { state: 'conflict' };
      const counts = this.counts(props);
      if (
        !counts ||
        (command === 'abort_job'
          ? counts.abort >= RESERVED_ABORT_ACTIONS
          : counts.ordinary >= MAX_ORDINARY_CONTROL_ACTIONS)
      )
        return { state: 'limit' };
      this.storage.kv.put(`${COUNT_PREFIX}${props.clientId}`, {
        ...counts,
        ordinary: counts.ordinary + (command === 'abort_job' ? 0 : 1),
        abort: counts.abort + (command === 'abort_job' ? 1 : 0),
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

  unknown(props: GrantProps, requestId: string): Record<string, unknown> {
    const saved = recordSchema.safeParse(this.storage.kv.get(keyFor(props.clientId, requestId)));
    const operation =
      saved.success && saved.data.leaseId === props.leaseId ? saved.data.operation : null;
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

  acknowledge(props: GrantProps, requestId: string, value: unknown): void {
    const parsed = mcpControlOperationSchema.safeParse(value);
    if (!parsed.success || parsed.data.operationId !== requestId) return;
    const key = keyFor(props.clientId, requestId);
    const saved = recordSchema.safeParse(this.storage.kv.get(key));
    if (!saved.success || saved.data.leaseId !== props.leaseId) return;
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
