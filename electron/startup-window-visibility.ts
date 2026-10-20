import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';

export function createStartupWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow(options);
  installStartupWindowVisibility(window);
  return window;
}

// Native visibility is separate from document.visibilityState: background
// throttling stays off so minimized jobs retain their wake lock (ADR-117).
// Publish only a boolean and monotonic revision to this window's renderer.
export function installStartupWindowVisibility(window: BrowserWindow): void {
  // Keep the contents captured: BrowserWindow.webContents is gone by 'closed',
  // and a main-process throw there blocks quitting behind Electron's dialog.
  const contents = window.webContents;
  let revision = 0;
  const publish = (): void => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    const visible = window.isVisible() && !window.isMinimized();
    revision += 1;
    const script = `(() => {
      const root = document.documentElement;
      if (!root || Number(root.dataset.desktopWindowVisibilityRevision ?? 0) > ${revision}) return;
      root.dataset.desktopWindowVisibilityRevision = '${revision}';
      root.dataset.desktopWindowVisible = '${visible}';
      window.dispatchEvent(new Event('kerfdesk:window-visibility'));
    })()`;
    void contents.executeJavaScript(script).catch(() => {
      // Navigation or closing can remove the document before delivery.
    });
  };
  // A maximized reveal and focus also resynchronise a missed show transition.
  const emitter = window as unknown as NodeJS.EventEmitter;
  const windowEvents = ['show', 'hide', 'minimize', 'restore', 'maximize', 'focus'];
  for (const event of windowEvents) emitter.on(event, publish);
  contents.on('dom-ready', publish);
  window.once('closed', () => {
    for (const event of windowEvents) emitter.removeListener(event, publish);
    contents.removeListener('dom-ready', publish);
  });
}
