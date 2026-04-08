import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:save', defaultName, content),
  saveGcode: (defaultName: string, content: string) =>
    ipcRenderer.invoke('dialog:saveGcode', defaultName, content),
  openFile: () =>
    ipcRenderer.invoke('dialog:open'),
  isElectron: true,
});
