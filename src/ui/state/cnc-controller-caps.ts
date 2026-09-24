import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';

// Only the feed ceilings ($110/$111/$112) become live caps. `$30` is the S
// value that means full output, not a measured spindle RPM, even with `$32=0`:
// a stock GRBL router reports `$30=1000` while its spindle turns 12 000 RPM,
// and capping auto-seeded operations to 1000 RPM sized their chip-load feeds
// about 12x too slow while `M3 S1000` still ran the spindle at full speed
// (controller audit cnc-controller-3). The explicit S-to-RPM choice in Machine
// Setup writes `$30` into the machine's spindle maximum when it is an RPM
// mapping, and that value already caps suggestions (ADR-322 item 6).
export function cncLiveCapsFromController(
  settings: ControllerSettingsSnapshot,
): CncMachineStarterLiveCaps {
  return {
    ...(settings.maxFeedX === undefined ? {} : { xMaxFeedMmPerMin: settings.maxFeedX }),
    ...(settings.maxFeedY === undefined ? {} : { yMaxFeedMmPerMin: settings.maxFeedY }),
    ...(settings.zMaxFeed === undefined ? {} : { zMaxFeedMmPerMin: settings.zMaxFeed }),
  };
}
