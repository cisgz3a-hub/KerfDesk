import { join } from 'node:path';

export const DESKTOP_PRODUCT_NAME = 'KerfDesk';
export const LEGACY_DESKTOP_DATA_DIRECTORY = 'laserforge';

// The public product rename must not strand existing projects, settings,
// recovery checkpoints, or Chromium storage. Both Electron paths are pinned
// before ready to the already-used LaserForge directory (ADR-248).
export function legacyDesktopDataPath(appDataPath: string): string {
  return join(appDataPath, LEGACY_DESKTOP_DATA_DIRECTORY);
}
