import { selectControllerDriver } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import type { JobReviewModel } from './job-review';

export const CONTROLLER_IDENTITY_WARNING_PREFIX = 'Controller identity mismatch:';
export const CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX = 'Controller identity unconfirmed:';

export function controllerIdentityWarnings(
  configured: ControllerKind,
  active: ControllerKind,
  detected: ControllerKind | null,
): ReadonlyArray<string> {
  const configuredLabel = controllerLabel(configured);
  const activeLabel = controllerLabel(active);
  if (active !== configured) {
    const detectedDetail =
      detected === null
        ? 'firmware detection is still unknown'
        : `detected firmware is ${controllerLabel(detected)}`;
    return [
      `${CONTROLLER_IDENTITY_WARNING_PREFIX} the selected profile is ${configuredLabel}, ` +
        `but the active connection uses ${activeLabel} and ${detectedDetail}. KerfDesk will ` +
        'prepare output from the selected profile while live parsing and controller commands use ' +
        'the active connection. Reconnect using the selected profile before relying on ' +
        'controller-specific behavior.',
    ];
  }
  if (detected !== null && detected !== configured) {
    return [
      `${CONTROLLER_IDENTITY_WARNING_PREFIX} the selected profile and active connection use ` +
        `${configuredLabel}, but the firmware banner identifies ${controllerLabel(detected)}. ` +
        'Reconnect using the selected profile before relying on controller-specific behavior.',
    ];
  }
  if (detected === null) {
    return [
      `${CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX} no firmware family has been detected in this ` +
        `controller session. The selected profile and active connection use ${configuredLabel}; ` +
        'verify the controller identity before relying on controller-specific behavior.',
    ];
  }
  return [];
}

export function refreshControllerIdentityWarnings(
  model: JobReviewModel,
  configured: ControllerKind,
  active: ControllerKind,
  detected: ControllerKind | null,
): JobReviewModel {
  const retained = model.warnings.filter((warning) => !isControllerIdentityWarning(warning));
  return {
    ...model,
    warnings: [...controllerIdentityWarnings(configured, active, detected), ...retained],
  };
}

export function isControllerIdentityWarning(warning: string): boolean {
  return (
    warning.startsWith(CONTROLLER_IDENTITY_WARNING_PREFIX) ||
    warning.startsWith(CONTROLLER_IDENTITY_UNCONFIRMED_PREFIX)
  );
}

function controllerLabel(kind: ControllerKind): string {
  return selectControllerDriver(kind).label;
}
