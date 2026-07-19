import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';

export function cncLiveCapsFromController(
  settings: ControllerSettingsSnapshot,
): CncMachineStarterLiveCaps {
  return {
    ...(settings.maxFeedX === undefined ? {} : { xMaxFeedMmPerMin: settings.maxFeedX }),
    ...(settings.maxFeedY === undefined ? {} : { yMaxFeedMmPerMin: settings.maxFeedY }),
    ...(settings.zMaxFeed === undefined ? {} : { zMaxFeedMmPerMin: settings.zMaxFeed }),
    // A hybrid 4040 commonly reports laser PWM $30=1000 while $32=1. That is
    // not a 1000 RPM spindle ceiling. Only a controller already in CNC mode
    // may contribute $30 to future CNC starter calculations.
    ...(settings.laserModeEnabled === false && settings.maxPowerS !== undefined
      ? { spindleMaxRpm: settings.maxPowerS }
      : {}),
  };
}
