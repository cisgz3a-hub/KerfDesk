// Marlin output strategy (ADR-095). The 'marlin-inline' dialect (LASER_FEATURE
// builds) shares GRBL's wire shape — M3/M4/M5 with per-move S — so the body is
// the GRBL emitter's output with the profile's S scale (Marlin convention:
// maxPowerS = 255). The 'marlin-fan' dialect post-transforms that body into
// M106/M107 fan-PWM control. Determinism (non-negotiable #5) is preserved:
// both paths are pure functions of (job, device).

import type { DeviceProfile } from '../devices';
import { resolveMarlinDialect } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';
import { toMarlinFanGcode } from './marlin-fan-transform';

export const marlinStrategy = {
  id: 'marlin' as const,
  emit: (job: Job, device: DeviceProfile): string => {
    const body = grblStrategy.emit(job, device);
    const dialect = resolveMarlinDialect(device);
    return dialect.powerMode === 'fan' ? toMarlinFanGcode(body, device.maxPowerS) : body;
  },
};
