// build-info — the single UI-boundary place that reads Vite's build-time
// globals (__GIT_SHA__ / __APP_VERSION__ / __BUILD_TIME__, injected by
// vite.config.ts) and assembles a GcodeMetadata. Core and io stay pure: they
// never touch these globals, they just receive the assembled value (P0-A).

import { EMITTER_REVISION, type GcodeMetadata } from '../../io/gcode';
import { APP_GCODE_NAME } from '../../core/app-branding';

export function buildGcodeMetadata(): GcodeMetadata {
  return {
    appName: APP_GCODE_NAME,
    appVersion: __APP_VERSION__,
    gitSha: __GIT_SHA__,
    buildTimeUtc: __BUILD_TIME__,
    emitterRevision: EMITTER_REVISION,
  };
}
