/**
 * HTTP client for the Falcon A1 Pro WiFi API.
 *
 * Design notes:
 *   - All endpoints live on http://<ip>:8080 and return a JSON envelope
 *     `{ errorcode: 0, payload: {...} }`, but Content-Type is reported as
 *     `text/html; charset=ISO-8859-1` — a Creality firmware bug. We parse
 *     the response body as JSON regardless of Content-Type.
 *   - The Falcon runs on WiFi; RTT commonly spikes to ~900 ms.
 *     We use a 10-second timeout to stay forgiving without hanging.
 *   - No auth of any kind.
 *   - Uses only Node built-ins (http) to avoid pulling in a new dependency.
 */

import http from 'node:http';

import type {
  FalconEnvelope,
  FalconLaserInfo,
  FalconTestConnectionResult,
  FalconDeviceStatus,
  FalconDeviceModuleStatus,
} from './FalconWiFiTypes';
import { FALCON_STATE, type FalconStateNumber } from './FalconWiFiEnums';

const HTTP_PORT = 8080;
const HTTP_TIMEOUT_MS = 10_000;

interface RawResponse {
  status: number;
  body: string;
  json: FalconEnvelope | null;
}

/** Low-level helper: never throws; resolves with status/body/parsed-json. */
function httpRequest(
  ip: string,
  method: 'GET' | 'POST',
  path: string,
  body: string | null = null,
  headers: Record<string, string> = {},
  timeoutMs: number = HTTP_TIMEOUT_MS,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const bodyBuf = body === null ? null : Buffer.from(body, 'utf8');
    const req = http.request(
      {
        hostname: ip,
        port: HTTP_PORT,
        method,
        path,
        headers: {
          Host: `${ip}:${HTTP_PORT}`,
          Connection: 'Keep-Alive',
          'Accept-Encoding': 'identity',
          'User-Agent': 'LaserForge',
          ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: FalconEnvelope | null = null;
          try {
            parsed = JSON.parse(text) as FalconEnvelope;
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: text, json: parsed });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Falcon HTTP timeout after ${timeoutMs}ms`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/** Perform a GET and return the parsed envelope; throws on timeout, network, or non-2xx. */
async function getJson<T>(ip: string, path: string): Promise<T> {
  const res = await httpRequest(ip, 'GET', path);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Falcon ${path} returned HTTP ${res.status}`);
  }
  if (!res.json) {
    throw new Error(`Falcon ${path} returned non-JSON body: ${res.body.slice(0, 120)}`);
  }
  if (res.json.errorcode !== 0) {
    throw new Error(`Falcon ${path} errorcode=${res.json.errorcode}`);
  }
  return res.json.payload as T;
}

export async function getDeviceModel(ip: string): Promise<string> {
  const payload = await getJson<{ deviceModel?: string }>(ip, '/system/getDeviceModel');
  if (!payload.deviceModel) throw new Error('Falcon returned empty deviceModel');
  return payload.deviceModel;
}

export async function getFirmwareVersion(ip: string): Promise<string> {
  const payload = await getJson<{ curversion?: string }>(ip, '/system/getCurVersion?from=falcon');
  return payload.curversion ?? 'unknown';
}

export async function getSerialNumber(ip: string): Promise<string | undefined> {
  try {
    const payload = await getJson<{ sn?: string; SN?: string }>(ip, '/system/getSN?from=falcon');
    return payload.sn ?? payload.SN;
  } catch {
    return undefined;
  }
}

export async function getLayerType(ip: string): Promise<FalconLaserInfo> {
  const payload = await getJson<FalconLaserInfo>(ip, '/work/getLayerType?from=falcon');
  return {
    laserType: payload.laserType ?? 'unknown',
    laserClass: payload.laserClass ?? 'unknown',
    zaxisVersion: payload.zaxisVersion ?? 'unknown',
    laserSN: payload.laserSN ?? '',
  };
}

/** Returns the parsed work-state enum number from /work/state. */
export async function getWorkState(ip: string): Promise<FalconStateNumber | number> {
  const payload = await getJson<{ state?: number }>(ip, '/work/state?from=falcon');
  if (typeof payload.state !== 'number') {
    throw new Error('Falcon /work/state missing numeric state');
  }
  return payload.state;
}

/**
 * Progress is returned as a string like "0.01" — parseFloat is mandatory.
 * Returns a number in [0,100] (caller can clamp); never throws on trailing
 * whitespace or weird formatting.
 */
export async function getWorkProgress(ip: string): Promise<number> {
  const payload = await getJson<{ progress?: string | number }>(ip, '/work/progress?from=falcon');
  const raw = payload.progress;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'));
  if (!Number.isFinite(n)) return 0;
  return n;
}

export async function getDeviceState(ip: string): Promise<{ isBusy: boolean | null }> {
  const payload = await getJson<{ isBusy?: boolean }>(ip, '/device/state');
  return { isBusy: typeof payload.isBusy === 'boolean' ? payload.isBusy : null };
}

export async function getDeviceStatus(ip: string): Promise<FalconDeviceStatus> {
  // /device/status isn't JSON-envelope-wrapped in the same way on some
  // firmwares — it can return { devList: [...] } directly under payload.
  try {
    const payload = await getJson<{ devList?: FalconDeviceModuleStatus[] }>(ip, '/device/status');
    const busyRes = await getDeviceState(ip).catch(() => ({ isBusy: null as boolean | null }));
    return {
      isBusy: busyRes.isBusy,
      modules: Array.isArray(payload.devList) ? payload.devList : [],
    };
  } catch {
    const busyRes = await getDeviceState(ip).catch(() => ({ isBusy: null as boolean | null }));
    return { isBusy: busyRes.isBusy, modules: [] };
  }
}

/**
 * High-level test-connection used by the setup UI: exercises three endpoints
 * in parallel. Any failure marks the whole test as failed, but we still try
 * to report partial info for diagnostics.
 */
export async function testConnection(ip: string): Promise<FalconTestConnectionResult> {
  const started = Date.now();
  try {
    const [deviceModel, firmwareVersion, laserInfo, serialNumber] = await Promise.all([
      getDeviceModel(ip),
      getFirmwareVersion(ip).catch(() => 'unknown'),
      getLayerType(ip).catch<FalconLaserInfo | null>(() => null),
      getSerialNumber(ip),
    ]);
    return {
      ok: true,
      deviceModel,
      firmwareVersion,
      laserInfo: laserInfo ?? undefined,
      serialNumber,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const elapsed = Date.now() - started;
    return { ok: false, error: `${msg} (after ${elapsed}ms)` };
  }
}

/** Convenience re-export so callers have one import. */
export { FALCON_STATE };
