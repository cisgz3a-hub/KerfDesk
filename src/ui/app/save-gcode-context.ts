// The one context Save G-code and the Inspector's views of the current canvas
// compile with, so the Inspector shows the bytes Save writes and Start streams
// (rolling audit v4 H1-P3-1). The Save dialog adds only the variable-text
// advance, which belongs to a real export.

import type { PlatformAdapter } from '../../platform/types';
import { currentOutputScope, type useStore } from '../state';
import type { useLaserStore } from '../state/laser-store';
import { nativeBedEvidenceSnapshot } from '../state/native-bed-frame';
import type { SaveGcodeCtx } from './file-actions';

export function currentSaveGcodeContext(args: {
  readonly platform: PlatformAdapter;
  readonly app: ReturnType<typeof useStore.getState>;
  readonly laser: ReturnType<typeof useLaserStore.getState>;
  readonly pushToast: SaveGcodeCtx['pushToast'];
}): Omit<SaveGcodeCtx, 'advanceVariablesAfter'> {
  const { app, laser } = args;
  return {
    platform: args.platform,
    project: app.project,
    savedName: app.savedName,
    jobPlacement: app.jobPlacement,
    outputScope: currentOutputScope(app),
    machine: {
      // Only a current connection supplies the $30 power range (ADR-567).
      connected: laser.connection.kind === 'connected',
      ...nativeBedEvidenceSnapshot(laser),
      statusReport: laser.statusReport,
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
      // Current Position bakes the live WPos into the bytes; an inch-reporting
      // controller ($13=1) must be normalized here exactly as Preview/Start do.
      reportInches: laser.controllerSettings?.reportInches === true,
    },
    controllerSettings: laser.controllerSettings,
    settingsCapability: laser.capabilities.settings,
    activeWcs: laser.activeWcs,
    pushToast: args.pushToast,
  };
}
