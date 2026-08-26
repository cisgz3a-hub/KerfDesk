import { recoverCncSubProfile } from '../../core/devices/cnc-sub-profile-validation';
import { DEFAULT_CNC_MACHINE_PARAMS } from '../../core/scene';

export function recoveredCncDevicePatch(device: Record<string, unknown>): Record<string, unknown> {
  if (device['cncSubProfile'] === undefined) return {};
  const recovery = recoverCncSubProfile(
    device['cncSubProfile'],
    DEFAULT_CNC_MACHINE_PARAMS,
    'device.cncSubProfile',
  );
  if (recovery.issues.length === 0) return { cncSubProfile: recovery.value };
  const evidence = Array.isArray(device['evidence']) ? device['evidence'] : [];
  return {
    cncSubProfile: recovery.value,
    evidence: [
      ...evidence,
      {
        label: 'CNC settings recovery',
        status: 'unverified',
        note: `${recovery.issues.join('; ')}. Invalid fields were restored to editable defaults; review Device Setup before output.`,
      },
    ],
  };
}
