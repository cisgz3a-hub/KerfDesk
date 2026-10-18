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
  let revision = 0;
  const publish = (): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    const visible = window.isVisible() && !window.isMinimized();
    revision += 1;
    const script = `(() => {
      const root = document.documentElement;
      if (!root || Number(root.dataset.desktopWindowVisibilityRevision ?? 0) > ${revision}) return;
      root.dataset.desktopWindowVisibilityRevision = '${revision}';
      root.dataset.desktopWindowVisible = '${visible}';
      window.dispatchEvent(new Event('kerfdesk:window-visibility'));
    })()`;
    void window.webContents.executeJavaScript(script).catch(() => {
      // Navigation or closing can remove the document before delivery.
    });
  };
  window.on('show', publish);
  window.on('hide', publish);
  window.on('minimize', publish);
  window.on('restore', publish);
  window.webContents.on('dom-ready', publish);
  window.once('closed', () => {
    window.removeListener('show', publish);
    window.removeListener('hide', publish);
    window.removeListener('minimize', publish);
    window.removeListener('restore', publish);
    window.webContents.removeListener('dom-ready', publish);
  });
}
