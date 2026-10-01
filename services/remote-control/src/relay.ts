import { z } from 'zod';
import { KerfDeskMcpError } from '../../../electron/mcp/backend.js';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas.js';
import { MAX_BYTES, parseCommand, type GrantProps, type RemoteScope } from './protocol.js';
import { sessionIdentity } from './security.js';

const relayResponseSchema = z.strictObject({
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z
    .strictObject({
      code: z.enum([
        'unavailable',
        'stale_revision',
        'needs_pro',
        'unsupported_operation',
        'invalid_input',
        'cancelled',
        'failed',
      ]),
      message: z.string().max(2048),
    })
    .nullable(),
});
export const device = (env: Env, id: string) =>
  env.REMOTE_DEVICES.get(env.REMOTE_DEVICES.idFromName(id));

export async function approvedSession(request: Request, env: Env) {
  const identity = await sessionIdentity(request);
  if (identity === null) return null;
  const info = await device(env, identity.deviceId).session(identity.clientId, identity.digest);
  return info.status === 'approved' ? { identity, info } : null;
}

export async function relayRequest(
  env: Env,
  props: GrantProps,
  scopes: RemoteScope,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  sessionDigest?: string,
  execution?: ExecutionContext,
): Promise<Record<string, unknown>> {
  const command = parseCommand({ name, args });
  if (!command) throw new KerfDeskMcpError('invalid_input');
  const stub = device(env, props.deviceId);
  const requestId = crypto.randomUUID();
  if (signal?.aborted) throw new KerfDeskMcpError('cancelled');
  const abort = () => {
    const cleanup = stub.cancelCommand(props.clientId, requestId).catch(() => undefined);
    // A disconnected HTTP client must not cancel the best-effort desktop cancellation RPC.
    if (execution) execution.waitUntil(cleanup);
    else void cleanup;
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const serialized = await stub.runCommand(
      props,
      scopes,
      requestId,
      JSON.stringify(command),
      sessionDigest,
    );
    if (signal?.aborted) throw new KerfDeskMcpError('cancelled');
    return decodeRelayResponse(serialized, command.name);
  } catch (error) {
    if (error instanceof KerfDeskMcpError) throw error;
    throw new KerfDeskMcpError('unavailable');
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function decodeRelayResponse(serialized: string, name: keyof typeof mcpOutputSchemas) {
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES)
    throw new KerfDeskMcpError('failed');
  const parsed = relayResponseSchema.safeParse(JSON.parse(serialized));
  if (!parsed.success) throw new KerfDeskMcpError('failed');
  const response = parsed.data;
  if (response.error !== null) throw new KerfDeskMcpError(response.error.code);
  if (response.result === null) throw new KerfDeskMcpError('failed');
  const output = mcpOutputSchemas[name].safeParse(response.result);
  if (!output.success) throw new KerfDeskMcpError('failed');
  return output.data;
}
