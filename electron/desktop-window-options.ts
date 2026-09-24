// The main window's renderer settings.
//
// backgroundThrottling stays off (controller audit electron-native-2). By
// default Electron reports a minimized, hidden or fully covered window as
// document.visibilityState 'hidden'. The W3C Screen Wake Lock then releases
// the lock ADR-117 holds for a running job, and nothing else keeps the
// computer awake: serial I/O does not reset the OS idle timer, so a walked-away
// multi-hour job could stall mid-cut when the OS slept. With throttling off
// the page stays 'visible', so the renderer's own wake lock keeps holding,
// with no main-process power API. The cost is that animation frames and
// compositing keep running while minimized. A browser tab cannot do this; see
// WORKFLOW for the web build.

export type MainWindowWebPreferences = {
  readonly contextIsolation: true;
  readonly devTools: boolean;
  readonly nodeIntegration: false;
  readonly sandbox: true;
  readonly webSecurity: true;
  readonly backgroundThrottling: false;
};

export function mainWindowWebPreferences(devTools: boolean): MainWindowWebPreferences {
  return {
    contextIsolation: true,
    devTools,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
  };
}
