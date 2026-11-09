import type { PlatformAdapter } from '../../platform/types';

/** Whether Open, Import and Save can show a file picker here (ADR-688). */
export function platformCanPickFiles(
  platform: Pick<PlatformAdapter, 'filePickersAvailable'>,
): boolean {
  return platform.filePickersAvailable?.() ?? true;
}

/** Whether Save can write a file here: through a picker, or as a download in
 * a browser without one (ADR-688 Amendment 2). */
export function platformCanSaveFiles(
  platform: Pick<PlatformAdapter, 'filePickersAvailable' | 'savesByDownload'>,
): boolean {
  return platformCanPickFiles(platform) || platform.savesByDownload?.() === true;
}
