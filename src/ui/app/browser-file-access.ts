import type { PlatformAdapter } from '../../platform/types';

/** Whether Open, Import and Save can show a file picker here (ADR-688). */
export function platformCanPickFiles(
  platform: Pick<PlatformAdapter, 'filePickersAvailable'>,
): boolean {
  return platform.filePickersAvailable?.() ?? true;
}
