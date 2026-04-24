import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:save', defaultName, content),
  saveGcode: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:saveGcode', defaultName, content),
  openFile: () =>
    ipcRenderer.invoke('dialog:open'),
  isElectron: true,
  listPorts: () => ipcRenderer.invoke('serial:list') as Promise<{ path: string; manufacturer?: string }[]>,
  connectPort: (portPath: string, baudRate: number) =>
    ipcRenderer.invoke('serial:connect', portPath, baudRate) as Promise<boolean>,
  disconnectPort: () => ipcRenderer.invoke('serial:disconnect') as Promise<void>,
  sendGcode: (cmd: string) => ipcRenderer.invoke('serial:send', cmd) as Promise<void>,
  quit: () => ipcRenderer.invoke('app:quit') as Promise<void>,
  storageGet: (key: string) => ipcRenderer.invoke('storage:get', key) as Promise<string | null>,
  storageSet: (key: string, value: string) =>
    ipcRenderer.invoke('storage:set', key, value) as Promise<void>,
  storageRemove: (key: string) => ipcRenderer.invoke('storage:remove', key) as Promise<void>,
  storageList: (prefix?: string) => ipcRenderer.invoke('storage:list', prefix) as Promise<string[]>,
  storageClear: () => ipcRenderer.invoke('storage:clear') as Promise<void>,

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
