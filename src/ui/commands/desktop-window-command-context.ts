import type { PlatformAdapter } from '../../platform/types';
import type { useToastStore } from '../state/toast-store';
import type { AppCommandContext } from './command-types';

type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];

/**
 * File > Exit and Help > Open Data Folder, where the desktop app offers them
 * (ADR-554). A failure says so in a toast; the data folder's names the folder.
 */
export function desktopWindowCommandContext(
  platform: Pick<PlatformAdapter, 'desktopWindow'>,
  pushToast: PushToast,
): Pick<AppCommandContext, 'exitApp' | 'openDataFolder'> {
  const desktop = platform.desktopWindow;
  if (desktop === undefined) return {};
  const report = (error: unknown) =>
    pushToast(error instanceof Error ? error.message : String(error), 'error');
  return {
    exitApp: () => void desktop.exit().catch(report),
    openDataFolder: () => void desktop.openDataFolder().catch(report),
  };
}
