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
import { normalizeFalconWifiIpcTarget } from './FalconTargetPolicy';
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
      const target = normalizeFalconWifiIpcTarget(ip);
      if (!target.ok) return { ok: false, error: target.error };
      return testConnection(target.target);
    },
  );

  ipcMain.handle(CH.getState, async (event, ip: unknown): Promise<number> => {
    assertTrustedSender(event);
    const target = normalizeFalconWifiIpcTarget(ip);
    if (!target.ok) throw new Error(target.error);
    return getWorkState(target.target);
  });

  ipcMain.handle(CH.getProgress, async (event, ip: unknown): Promise<number> => {
    assertTrustedSender(event);
    const target = normalizeFalconWifiIpcTarget(ip);
    if (!target.ok) throw new Error(target.error);
    return getWorkProgress(target.target);
  });

  ipcMain.handle(
    CH.getDeviceStatus,
    async (event, ip: unknown): Promise<FalconDeviceStatus> => {
      assertTrustedSender(event);
      const target = normalizeFalconWifiIpcTarget(ip);
      if (!target.ok) throw new Error(target.error);
      return getDeviceStatus(target.target);
    },
  );

  ipcMain.handle(
    CH.wsConnect,
    async (event, ip: unknown): Promise<{ ok: boolean; error?: string }> => {
      assertTrustedSender(event);
      const target = normalizeFalconWifiIpcTarget(ip);
      if (!target.ok) return { ok: false, error: target.error };
      refreshWindow();
      closeActiveHandle();
      try {
        activeHandle = connectFalconWebSocket(target.target, forwardEvent);
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
