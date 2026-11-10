// `updateDeviceProfile`'s change without its history entry, so an action that
// edits the machine together with something else records one undo step and
// keeps the Machine Setup history context (ADR-361 Amendment 1).

import type { DeviceProfile } from '../../core/devices';
import { deviceProfileWithInteractivePatch } from '../../core/devices/device-profile-patch';
import { jobPlacementAfterDeviceChange } from '../job-placement';
import { projectAfterDeviceProfileChange } from './cnc-machine-setup-scene';
import { captureSetupHistoryContext } from './setup-history-context';
import type { AppState } from './store';

/** The project and job placement after `patch`. Captures the Machine Setup
 * history context against `s.project`, the snapshot the caller pushes. */
export function deviceProfileChangeState(
  s: AppState,
  patch: Partial<DeviceProfile>,
): Pick<AppState, 'project' | 'jobPlacement'> {
  captureSetupHistoryContext(s.project, s);
  const nextDevice = deviceProfileWithInteractivePatch(s.project.device, patch);
  return {
    project: projectAfterDeviceProfileChange(s.project, nextDevice, s.cncLiveCaps),
    jobPlacement: jobPlacementAfterDeviceChange(s.jobPlacement, s.project.device, nextDevice),
  };
}
