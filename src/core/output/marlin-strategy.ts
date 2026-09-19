// Reuse geometric emission, then apply Marlin's native power/mode contract.
// Inline power needs explicit M3 I entry and M5 I exit on modern LASER_FEATURE
// builds; fan-mosfet wiring instead uses M106/M107 in fixed 0..255 units.

import type { DeviceProfile } from '../devices';
import { resolveMarlinDialect } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';
import { toMarlinFanGcode } from './marlin-fan-transform';
import { MARLIN_FAN_MAX_POWER, marlinFanRasterJob } from './marlin-fan-raster';
import { toMarlinInlineGcode, withoutGrblWorkspacePreamble } from './marlin-inline-transform';
import type { OutputEmitOptions } from './output-strategy';

export const marlinStrategy = {
  id: 'marlin' as const,
  emit: (job: Job, device: DeviceProfile, options: OutputEmitOptions = {}): string => {
    const dialect = resolveMarlinDialect(device);
    const intermediateDevice: DeviceProfile = {
      ...device,
      gcodeDialect: { dialectId: 'grbl-dynamic' },
      ...(dialect.powerMode === 'fan' ? { maxPowerS: MARLIN_FAN_MAX_POWER } : {}),
    };
    const intermediateJob =
      dialect.powerMode === 'fan' ? marlinFanRasterJob(job, device.maxPowerS) : job;
    const body = withoutGrblWorkspacePreamble(
      grblStrategy.emit(intermediateJob, intermediateDevice, options),
    );
    return dialect.powerMode === 'fan'
      ? toMarlinFanGcode(body, MARLIN_FAN_MAX_POWER)
      : toMarlinInlineGcode(body);
  },
};
