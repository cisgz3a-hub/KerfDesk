import { contextBridge, ipcRenderer } from 'electron';

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
  startBridge: (laserIp: string, wsPort: number) =>
    ipcRenderer.invoke('bridge:start', laserIp, wsPort) as Promise<{ ok: boolean; error?: string }>,
  stopBridge: () =>
    ipcRenderer.invoke('bridge:stop') as Promise<void>,
});
