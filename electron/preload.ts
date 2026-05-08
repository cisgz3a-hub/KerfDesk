import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function storageScope(channelPrefix: string) {
  return {
    get: (key: string) => ipcRenderer.invoke(`${channelPrefix}:get`, key) as Promise<string | null>,
    set: (key: string, value: string) =>
      ipcRenderer.invoke(`${channelPrefix}:set`, key, value) as Promise<void>,
    remove: (key: string) => ipcRenderer.invoke(`${channelPrefix}:remove`, key) as Promise<void>,
    list: () => ipcRenderer.invoke(`${channelPrefix}:list`) as Promise<string[]>,
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:save', defaultName, content),
  saveGcode: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:saveGcode', defaultName, content),
  openFile: () =>
    ipcRenderer.invoke('dialog:open'),
  isElectron: true,
  // T2-35: native Electron serial IPC exports removed. Web Serial remains the
  // controller path; no renderer-exposed serial:* bridge exists here.
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  storage: {
    deviceProfiles: storageScope('storage:deviceProfiles'),
    materials: storageScope('storage:materials'),
    autosave: storageScope('storage:autosave'),
    jobLogs: storageScope('storage:jobLogs'),
    replays: storageScope('storage:replays'),
    entitlements: storageScope('storage:entitlements'),
    diagnostics: storageScope('storage:diagnostics'),
    settings: storageScope('storage:settings'),
  },
  // T1-84: storageClear removed. See electron/main.ts for the explanation.
  acquireJobWakeLock: () =>
    ipcRenderer.invoke('power:acquireJobWakeLock') as Promise<number>,
  releaseJobWakeLock: () =>
    ipcRenderer.invoke('power:releaseJobWakeLock') as Promise<void>,
  updates: {
    check: () =>
      ipcRenderer.invoke('update:check') as Promise<unknown>,
    install: (state?: { jobRunning?: boolean }) =>
      ipcRenderer.invoke('update:install', state) as Promise<unknown>,
    onEvent: (handler: (event: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, event: unknown) => handler(event);
      ipcRenderer.on('update:event', listener);
      return () => {
        ipcRenderer.removeListener('update:event', listener);
      };
    },
  },

  // ─── Falcon WiFi (Phase 1: read-only status monitoring) ─────────
  falconWifi: {
    testConnection: (ip: string) =>
      ipcRenderer.invoke('falcon-wifi:test-connection', ip) as Promise<unknown>,
    getState: (ip: string) =>
      ipcRenderer.invoke('falcon-wifi:get-state', ip) as Promise<number>,
    getProgress: (ip: string) =>
      ipcRenderer.invoke('falcon-wifi:get-progress', ip) as Promise<number>,
    getDeviceStatus: (ip: string) =>
      ipcRenderer.invoke('falcon-wifi:get-device-status', ip) as Promise<unknown>,
    wsConnect: (ip: string) =>
      ipcRenderer.invoke('falcon-wifi:ws-connect', ip) as Promise<{ ok: boolean; error?: string }>,
    wsDisconnect: () =>
      ipcRenderer.invoke('falcon-wifi:ws-disconnect') as Promise<void>,
    wsStatus: () =>
      ipcRenderer.invoke('falcon-wifi:ws-status') as Promise<{ connected: boolean; ip: string | null }>,
    /**
     * Subscribe to WebSocket events. Returns an unsubscribe function. The
     * payload shape is validated on the renderer side (see `falconIpc.ts`).
     */
    onWsEvent: (handler: (event: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, event: unknown) => handler(event);
      ipcRenderer.on('falcon-wifi:ws-event', listener);
      return () => {
        ipcRenderer.removeListener('falcon-wifi:ws-event', listener);
      };
    },
  },
});
