import { join } from 'node:path';

export const DESKTOP_PRODUCT_NAME = 'KerfDesk';
export const LEGACY_DESKTOP_DATA_DIRECTORY = 'laserforge';

// The Windows Application User Model ID. The NSIS installer stamps the Start
// menu and desktop shortcuts with electron-builder's appId, and Windows shows a
// desktop app's notifications (the updater's "update ready" toast) and groups
// its taskbar button only when the running process carries the same ID.
// Electron sets it automatically for Squirrel installs only (ADR-482).
export const DESKTOP_APP_USER_MODEL_ID = 'dev.laserforge.app';

// The public product rename must not strand existing projects, settings,
// recovery checkpoints, or Chromium storage. Both Electron paths are pinned
// before ready to the already-used LaserForge directory (ADR-248).
export function legacyDesktopDataPath(appDataPath: string): string {
  return join(appDataPath, LEGACY_DESKTOP_DATA_DIRECTORY);
}
