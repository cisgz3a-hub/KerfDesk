// G-code command actions: Save G-code, the ADR-255 live-canvas Inspector
// entry, and the Inspector file picker. Save and Inspect share ONE context
// builder so the Inspector renders exactly what Save/Start would emit — the
// Inspector simply omits the variable-text advance, which belongs to a real
// export.

import { profileSupportsCapability } from '../../core/devices';
import { handleSaveGcode } from '../app/file-actions';
import { handleOpenGcodeInspector } from '../app/gcode-open-action';
import { handleInspectCurrentGcode } from '../app/inspect-current-gcode-action';
import type { PlatformAdapter } from '../../platform/types';
import { currentOutputScope } from '../state';
import type { useStore } from '../state';
import type { useLaserStore } from '../state/laser-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import type { useToastStore } from '../state/toast-store';

type AppState = ReturnType<typeof useStore.getState>;
type LaserState = ReturnType<typeof useLaserStore.getState>;
type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];
type SaveGcodeArgs = Parameters<typeof handleSaveGcode>[0];

export type GcodeActionDeps = {
  readonly platform: PlatformAdapter;
  readonly app: AppState;
  readonly laser: LaserState;
  readonly pushToast: PushToast;
  readonly openInspector: (programName: string, text: string) => void;
};

export function saveGcodeAction(deps: GcodeActionDeps): () => void {
  return () =>
    void handleSaveGcode({
      ...saveGcodeContext(deps),
      advanceVariablesAfter: deps.app.advanceVariablesAfter,
    });
}

export function inspectCurrentGcodeAction(deps: GcodeActionDeps): () => void {
  return () => void handleInspectCurrentGcode(saveGcodeContext(deps), deps.openInspector);
}

export function openGcodeInspectorAction(deps: GcodeActionDeps): () => void {
  return () => void handleOpenGcodeInspector(deps.platform, deps.openInspector, deps.pushToast);
}

/** Shared by the commands above and the main-canvas G-code view, so every
 * surface compiles through the identical Save path. */
export function saveGcodeContext(
  deps: GcodeActionDeps,
): Omit<SaveGcodeArgs, 'advanceVariablesAfter'> {
  const { app, laser } = deps;
  return {
    platform: deps.platform,
    project: app.project,
    savedName: app.savedName,
    jobPlacement: app.jobPlacement,
    outputScope: currentOutputScope(app),
    machine: {
      statusReport: laser.statusReport,
      workOriginActive: laser.workOriginActive,
      wcoCache: laser.wcoCache,
    },
    controllerSettings: laser.controllerSettings,
    activeWcs: laser.activeWcs,
    allowRotaryRaster:
      useExperimentalLaserFeatures.getState().features.rotaryRaster &&
      profileSupportsCapability(app.project.device, 'rotary'),
    pushToast: deps.pushToast,
  };
}
