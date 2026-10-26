// The desktop window's camera bridge connection (rolling audit v2 04-P2-1,
// ADR-141 Amendment 2): before each camera request the window asks main, over
// app://app, where the bridge is and for this launch's keys, or why it is not
// running. A port another program took is then named as such, instead of
// "available only in KerfDesk Desktop". The app root hands this to the web
// bridge client, which checks the bridge's proof before it sends a camera
// address.

import type { CameraBridgeConnection } from '../types';

const CONNECTION_URL = 'app://app/api/camera-bridge/connection';
const MAIN_NOT_ANSWERING_REASON =
  'KerfDesk could not find out whether its network-camera bridge is running. Restart KerfDesk.';

export async function desktopCameraBridgeConnection(
  fetcher: typeof fetch = fetch,
): Promise<CameraBridgeConnection> {
  try {
    const response = await fetcher(CONNECTION_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-KerfDesk-Camera-Bridge': '1' },
      cache: 'no-store',
    });
    if (!response.ok) return { kind: 'unavailable', reason: MAIN_NOT_ANSWERING_REASON };
    return connectionFrom(await response.json());
  } catch {
    return { kind: 'unavailable', reason: MAIN_NOT_ANSWERING_REASON };
  }
}

function connectionFrom(value: unknown): CameraBridgeConnection {
  if (typeof value !== 'object' || value === null) {
    return { kind: 'unavailable', reason: MAIN_NOT_ANSWERING_REASON };
  }
  const record = value as Record<string, unknown>;
  const { origin, proofKey, clientToken, reason } = record;
  if (
    record['kind'] === 'running' &&
    typeof origin === 'string' &&
    typeof proofKey === 'string' &&
    typeof clientToken === 'string'
  ) {
    return { kind: 'keyed', origin, proofKey, clientToken };
  }
  if (record['kind'] === 'unavailable' && typeof reason === 'string') {
    return { kind: 'unavailable', reason };
  }
  return { kind: 'unavailable', reason: MAIN_NOT_ANSWERING_REASON };
}
