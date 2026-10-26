import { selectControllerDriver } from '../../core/controllers';
import { usePlatform } from '../app/platform-context';
import { connectOptionsForDevice } from '../commands/connect-options';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';

/** Reconnect shared by the connection bar and the safety notice. The store
 * decides at click time whether a reconnect is still recommended. */
export function useControllerReconnect(): () => void {
  const platform = usePlatform();
  const connectController = useLaserStore((state) => state.connect);
  return () => {
    if (!useLaserStore.getState().getControllerReconnectRecommended()) return;
    // One builder with the menu Connect, read at click time, so the profile's
    // "Stream in worker" opt-in (ADR-334) is honoured on every Connect surface;
    // the rail used to rebuild the options without it (audit connect-6/ui-panel-7).
    void connectController(
      platform,
      connectOptionsForDevice(useStore.getState().project.device),
    ).catch(controllerActionFailureHandler('Reconnect'));
  };
}

/** Retry shared by Controller info and the canvas recovery card (ADR-642). The
 * store's read readiness is checked again at click time. */
export function useControllerQualificationRetry(): () => void {
  const retryQualification = useLaserStore((state) => state.retryControllerQualification);
  return () => {
    if (useLaserStore.getState().getMachineSettingsReadBlockReason() !== null) return;
    void retryQualification().catch(controllerActionFailureHandler('Check controller'));
  };
}

export function isFileOnlyController(
  controllerKind: Parameters<typeof selectControllerDriver>[0],
): boolean {
  return selectControllerDriver(controllerKind).capabilities.transport === 'file-only';
}
