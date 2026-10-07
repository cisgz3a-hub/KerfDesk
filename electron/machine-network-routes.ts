import { trustedAppRequest } from './app-route-guard.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { MachineNetworkBridge } from './machine-network-bridge.js';
import { app } from 'electron';

const bridge = new MachineNetworkBridge();
const PREFIX = '/api/machine-network/';
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json; charset=utf-8',
};
export function closeDesktopMachineNetwork(): void {
  bridge.dispose();
}
let quitRegistered = false;

export function withMachineNetworkRoutes(
  fallback: ProtocolHandler,
  network: MachineNetworkBridge = bridge,
): ProtocolHandler {
  if (network === bridge && !quitRegistered) {
    quitRegistered = true;
    app.once('will-quit', closeDesktopMachineNetwork);
  }
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    const action = url.pathname.slice(PREFIX.length);
    if (
      !['open', 'read', 'write', 'close'].includes(action) ||
      request.method !== 'POST' ||
      !trustedAppRequest(request, url, 'X-KerfDesk-Machine-Network')
    )
      return new Response('Not Found', { status: 404, headers: HEADERS });
    try {
      const data = await boundedBody(request);
      const result = await dispatch(network, action, data);
      return Response.json(result, { headers: HEADERS });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Network request failed.' },
        { status: 400, headers: HEADERS },
      );
    }
  };
}

async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new Error('Missing network request body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 96 * 1024) {
        await reader.cancel();
        throw new Error('Network request exceeds its local limit.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Invalid network request body.');
  return parsed as Record<string, unknown>;
}

async function dispatch(
  network: MachineNetworkBridge,
  action: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  if (action === 'open') {
    if (
      typeof data['host'] !== 'string' ||
      typeof data['port'] !== 'number' ||
      data['protocol'] !== 'fluidnc-telnet'
    )
      throw new Error('Only the documented FluidNC Telnet channel is supported.');
    return network.open(data['host'], data['port']);
  }
  const id = data['sessionId'];
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error('Invalid network session identity.');
  if (action === 'read') return network.read(id);
  if (action === 'close') {
    network.close(id);
    return { closed: true };
  }
  if (
    typeof data['sequence'] !== 'number' ||
    !Number.isInteger(data['sequence']) ||
    typeof data['data'] !== 'string'
  )
    throw new Error('Invalid network write.');
  await network.write(id, data['sequence'], data['data']);
  return { written: true };
}
