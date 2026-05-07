/**
 * Falcon WiFi IPC surface for the Electron main process.
 *
 * Responsibilities:
 *   - Wrap the HTTP and WebSocket clients with typed IPC invoke handlers.
 *   - Own the single active WebSocket connection (Phase 1 supports exactly
 *     one Falcon at a time; Phase 2 may extend to multi-device).
 *   - Forward WS events to the renderer via webContents.send() on the
 *     'falcon-wifi:ws-event' channel.
 *
 * Channels exposed (renderer → main, invoke):
 *   falcon-wifi:test-connection    (ip)              -> FalconTestConnectionResult
 *   falcon-wifi:get-state          (ip)              -> number  (state enum)
 *   falcon-wifi:get-progress       (ip)              -> number  (0..100)
 *   falcon-wifi:get-device-status  (ip)              -> FalconDeviceStatus
 *   falcon-wifi:ws-connect         (ip)              -> { ok, error? }
 *   falcon-wifi:ws-disconnect      ()                -> void
 *   falcon-wifi:ws-status          ()                -> { connected, ip }
 *
 * Channels pushed (main → renderer):
 *   falcon-wifi:ws-event           FalconWsEvent
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { assertTrustedSender } from '../security';

import {
  testConnection,
  getWorkState,
  getWorkProgress,
  getDeviceStatus,
} from './FalconHttpClient';
import { connectFalconWebSocket, type FalconWsHandle } from './FalconWebSocket';
import type {
  FalconDeviceStatus,
  FalconTestConnectionResult,
  FalconWsEvent,
} from './FalconWiFiTypes';

const CH = {
  testConnection: 'falcon-wifi:test-connection',
  getState: 'falcon-wifi:get-state',
  getProgress: 'falcon-wifi:get-progress',
  getDeviceStatus: 'falcon-wifi:get-device-status',
  wsConnect: 'falcon-wifi:ws-connect',
  wsDisconnect: 'falcon-wifi:ws-disconnect',
  wsStatus: 'falcon-wifi:ws-status',
  wsEvent: 'falcon-wifi:ws-event',
} as const;

function isValidIp(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0 || s.length > 64) return false;
  // Permit hostnames and IPv4 only — anything with scheme or path is rejected.
  // We do NOT try to validate full RFC compliance; this is a cheap guard against
  // accidental URL injection from the renderer.
  return /^[A-Za-z0-9._-]+$/.test(s);
}

let activeHandle: FalconWsHandle | null = null;
let activeWindow: BrowserWindow | null = null;

function forwardEvent(event: FalconWsEvent): void {
  const w = activeWindow;
  if (!w || w.isDestroyed()) return;
  try {
    w.webContents.send(CH.wsEvent, event);
  } catch (err) {
    console.error('[falcon-wifi] forwardEvent failed:', err);
  }
}

function closeActiveHandle(): void {
  const h = activeHandle;
  activeHandle = null;
  if (h) {
    try {
      h.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Register Falcon WiFi IPC handlers. Call once from electron/main.ts after
 * the BrowserWindow has been created; the provided accessor lets us push
 * events to the *current* window if it ever gets rebuilt.
 */
export function registerFalconWiFiIpc(getWindow: () => BrowserWindow | null): void {
  activeWindow = getWindow();

  // Refresh the window pointer each invoke in case the renderer reloaded.
  const refreshWindow = () => {
    activeWindow = getWindow();
  };

  ipcMain.handle(
    CH.testConnection,
    async (event, ip: unknown): Promise<FalconTestConnectionResult> => {
      assertTrustedSender(event);
      if (!isValidIp(ip)) return { ok: false, error: 'Invalid IP/host' };
      return testConnection(ip);
    },
  );

  ipcMain.handle(CH.getState, async (event, ip: unknown): Promise<number> => {
    assertTrustedSender(event);
    if (!isValidIp(ip)) throw new Error('Invalid IP/host');
    return getWorkState(ip);
  });

  ipcMain.handle(CH.getProgress, async (event, ip: unknown): Promise<number> => {
    assertTrustedSender(event);
    if (!isValidIp(ip)) throw new Error('Invalid IP/host');
    return getWorkProgress(ip);
  });

  ipcMain.handle(
    CH.getDeviceStatus,
    async (event, ip: unknown): Promise<FalconDeviceStatus> => {
      assertTrustedSender(event);
      if (!isValidIp(ip)) throw new Error('Invalid IP/host');
      return getDeviceStatus(ip);
    },
  );

  ipcMain.handle(
    CH.wsConnect,
    async (event, ip: unknown): Promise<{ ok: boolean; error?: string }> => {
      assertTrustedSender(event);
      if (!isValidIp(ip)) return { ok: false, error: 'Invalid IP/host' };
      refreshWindow();
      closeActiveHandle();
      try {
        activeHandle = connectFalconWebSocket(ip, forwardEvent);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(CH.wsDisconnect, async (event) => {
    assertTrustedSender(event);
    closeActiveHandle();
  });

  ipcMain.handle(CH.wsStatus, (event) => {
    assertTrustedSender(event);
    return {
      connected: !!activeHandle && activeHandle.isActive(),
      ip: activeHandle?.ip ?? null,
    };
  });
}

/** Called from before-quit to avoid leaking the socket. */
export function shutdownFalconWiFi(): void {
  closeActiveHandle();
}

export const FALCON_WIFI_CHANNELS = CH;
