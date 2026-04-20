/**
 * Typed renderer-side wrapper around the Falcon WiFi IPC surface exposed by
 * electron/preload.ts. Keeps the rest of the UI free of `window as any` casts
 * and validates incoming WebSocket event shapes.
 */

export interface FalconLaserInfo {
  laserType: string;
  laserClass: string;
  zaxisVersion: string;
  laserSN: string;
}

export interface FalconTestConnectionResult {
  ok: boolean;
  deviceModel?: string;
  firmwareVersion?: string;
  laserInfo?: FalconLaserInfo;
  serialNumber?: string;
  error?: string;
}

export interface FalconDeviceModuleStatus {
  module: string;
  curState?: number;
  isExist?: boolean;
}

export interface FalconDeviceStatus {
  isBusy: boolean | null;
  modules: FalconDeviceModuleStatus[];
}

export type FalconWsEvent =
  | { kind: 'connection'; state: 'connecting' | 'open' | 'closed' | 'error'; error?: string }
  | { kind: 'snapshot'; modules: FalconDeviceModuleStatus[] }
  | { kind: 'printer'; curState: number }
  | { kind: 'safeDoor'; curState: number }
  | { kind: 'alarm'; type: number; code: string }
  | { kind: 'module'; module: string; curState?: number; isExist?: boolean }
  | { kind: 'raw'; text: string };

interface FalconApi {
  testConnection: (ip: string) => Promise<FalconTestConnectionResult>;
  getState: (ip: string) => Promise<number>;
  getProgress: (ip: string) => Promise<number>;
  getDeviceStatus: (ip: string) => Promise<FalconDeviceStatus>;
  wsConnect: (ip: string) => Promise<{ ok: boolean; error?: string }>;
  wsDisconnect: () => Promise<void>;
  wsStatus: () => Promise<{ connected: boolean; ip: string | null }>;
  onWsEvent: (handler: (event: FalconWsEvent) => void) => () => void;
}

interface ElectronAPIWithFalcon {
  falconWifi?: {
    testConnection: (ip: string) => Promise<unknown>;
    getState: (ip: string) => Promise<number>;
    getProgress: (ip: string) => Promise<number>;
    getDeviceStatus: (ip: string) => Promise<unknown>;
    wsConnect: (ip: string) => Promise<{ ok: boolean; error?: string }>;
    wsDisconnect: () => Promise<void>;
    wsStatus: () => Promise<{ connected: boolean; ip: string | null }>;
    onWsEvent: (handler: (event: unknown) => void) => () => void;
  };
}

function getRawApi(): ElectronAPIWithFalcon['falconWifi'] | null {
  const api = (window as unknown as { electronAPI?: ElectronAPIWithFalcon }).electronAPI;
  return api?.falconWifi ?? null;
}

/** True when the Falcon IPC surface is available (i.e. running inside Electron with preload active). */
export function isFalconWiFiAvailable(): boolean {
  return getRawApi() !== null;
}

/** Ensures a Falcon IPC method was actually exposed before calling it. */
function requireApi(): NonNullable<ElectronAPIWithFalcon['falconWifi']> {
  const api = getRawApi();
  if (!api) {
    throw new Error('Falcon WiFi IPC unavailable — not running inside Electron?');
  }
  return api;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function sanitiseLaserInfo(v: unknown): FalconLaserInfo | undefined {
  if (!isRecord(v)) return undefined;
  const laserType = typeof v.laserType === 'string' ? v.laserType : 'unknown';
  const laserClass = typeof v.laserClass === 'string' ? v.laserClass : 'unknown';
  const zaxisVersion = typeof v.zaxisVersion === 'string' ? v.zaxisVersion : 'unknown';
  const laserSN = typeof v.laserSN === 'string' ? v.laserSN : '';
  return { laserType, laserClass, zaxisVersion, laserSN };
}

function sanitiseTestResult(v: unknown): FalconTestConnectionResult {
  if (!isRecord(v)) return { ok: false, error: 'Malformed response' };
  const ok = v.ok === true;
  return {
    ok,
    deviceModel: typeof v.deviceModel === 'string' ? v.deviceModel : undefined,
    firmwareVersion: typeof v.firmwareVersion === 'string' ? v.firmwareVersion : undefined,
    laserInfo: sanitiseLaserInfo(v.laserInfo),
    serialNumber: typeof v.serialNumber === 'string' ? v.serialNumber : undefined,
    error: typeof v.error === 'string' ? v.error : undefined,
  };
}

function sanitiseDeviceStatus(v: unknown): FalconDeviceStatus {
  if (!isRecord(v)) return { isBusy: null, modules: [] };
  const modules = Array.isArray(v.modules)
    ? v.modules
        .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.module === 'string')
        .map((m) => ({
          module: m.module as string,
          curState: typeof m.curState === 'number' ? (m.curState as number) : undefined,
          isExist: typeof m.isExist === 'boolean' ? (m.isExist as boolean) : undefined,
        }))
    : [];
  return {
    isBusy: typeof v.isBusy === 'boolean' ? v.isBusy : null,
    modules,
  };
}

/**
 * Narrow & validate an incoming WS event. Anything we don't recognise is
 * surfaced as `kind: 'raw'` so the consumer can log it.
 */
function sanitiseWsEvent(v: unknown): FalconWsEvent | null {
  if (!isRecord(v)) return null;
  const kind = v.kind;
  switch (kind) {
    case 'connection': {
      const state = v.state;
      if (state === 'connecting' || state === 'open' || state === 'closed' || state === 'error') {
        return {
          kind: 'connection',
          state,
          error: typeof v.error === 'string' ? v.error : undefined,
        };
      }
      return null;
    }
    case 'snapshot': {
      if (!Array.isArray(v.modules)) return { kind: 'snapshot', modules: [] };
      const modules = v.modules
        .filter((m): m is Record<string, unknown> => isRecord(m) && typeof m.module === 'string')
        .map((m) => ({
          module: m.module as string,
          curState: typeof m.curState === 'number' ? (m.curState as number) : undefined,
          isExist: typeof m.isExist === 'boolean' ? (m.isExist as boolean) : undefined,
        }));
      return { kind: 'snapshot', modules };
    }
    case 'printer':
      return typeof v.curState === 'number' ? { kind: 'printer', curState: v.curState } : null;
    case 'safeDoor':
      return typeof v.curState === 'number' ? { kind: 'safeDoor', curState: v.curState } : null;
    case 'alarm':
      if (typeof v.type === 'number' && typeof v.code === 'string') {
        return { kind: 'alarm', type: v.type, code: v.code };
      }
      return null;
    case 'module':
      if (typeof v.module === 'string') {
        return {
          kind: 'module',
          module: v.module,
          curState: typeof v.curState === 'number' ? v.curState : undefined,
          isExist: typeof v.isExist === 'boolean' ? v.isExist : undefined,
        };
      }
      return null;
    case 'raw':
      return { kind: 'raw', text: typeof v.text === 'string' ? v.text : '' };
    default:
      return null;
  }
}

export const falconIpc: FalconApi = {
  async testConnection(ip) {
    return sanitiseTestResult(await requireApi().testConnection(ip));
  },
  async getState(ip) {
    return requireApi().getState(ip);
  },
  async getProgress(ip) {
    return requireApi().getProgress(ip);
  },
  async getDeviceStatus(ip) {
    return sanitiseDeviceStatus(await requireApi().getDeviceStatus(ip));
  },
  async wsConnect(ip) {
    return requireApi().wsConnect(ip);
  },
  async wsDisconnect() {
    return requireApi().wsDisconnect();
  },
  async wsStatus() {
    return requireApi().wsStatus();
  },
  onWsEvent(handler) {
    return requireApi().onWsEvent((raw) => {
      const event = sanitiseWsEvent(raw);
      if (event) handler(event);
    });
  },
};

/** Shared display helper so callers stay in sync with the main-process enum. */
export const FALCON_STATE_NAMES: Record<number, string> = {
  2: 'IDLE',
  8: 'RUNNING',
  32: 'S32',
  64: 'FRAMING',
  256: 'TRANSIT',
  512: 'S512',
};

export function falconStateName(n: number | null | undefined): string {
  if (n == null) return 'UNKNOWN';
  return FALCON_STATE_NAMES[n] ?? `UNK(${n})`;
}

export function falconStateColor(n: number | null | undefined): string {
  switch (n) {
    case 2:
      return '#2dd4a0'; // idle — green
    case 8:
      return '#00d4ff'; // running — cyan
    case 64:
      return '#f0b429'; // framing — amber
    case 32:
    case 256:
    case 512:
      return '#8888aa'; // transitional / init — grey
    default:
      return '#555570';
  }
}
