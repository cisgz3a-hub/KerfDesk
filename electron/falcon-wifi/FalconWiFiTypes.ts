/**
 * Shared types for the Falcon WiFi client. These shapes cross the IPC
 * boundary, so keep them serialisable (plain JSON).
 */

/** Standard Falcon JSON envelope. */
export interface FalconEnvelope<T = unknown> {
  errorcode: number;
  payload?: T;
}

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

/**
 * Events emitted by the Falcon WebSocket. Shape matches the raw JSON
 * we see on the wire, with a few synthetic entries added by the service
 * (connection-state transitions and auto-reconnect notifications).
 */
export type FalconWsEvent =
  | { kind: 'connection'; state: 'connecting' | 'open' | 'closed' | 'error'; error?: string }
  | { kind: 'snapshot'; modules: FalconDeviceModuleStatus[] }
  | { kind: 'printer'; curState: number }
  | { kind: 'safeDoor'; curState: number }
  | { kind: 'alarm'; type: number; code: string }
  | { kind: 'module'; module: string; curState?: number; isExist?: boolean }
  | { kind: 'raw'; text: string };

export interface FalconHttpError {
  message: string;
  code?: string;
  status?: number;
}
