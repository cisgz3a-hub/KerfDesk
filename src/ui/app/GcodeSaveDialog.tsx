import { useEffect, useState } from 'react';
import { profileSupportsCapability } from '../../core/devices';
import { Button, Dialog, DialogActions } from '../kit';
import { currentOutputScope, useStore } from '../state';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { usePlatform } from './platform-context';
import {
  handleSaveGcode,
  ordinaryGcodeSaveUsesPrebuiltDialog,
  prebuildGcodeSave,
  type PrebuiltGcodeSave,
  type SaveGcodeCtx,
} from './file-actions';

type PreparationState =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'ready'; readonly artifact: PrebuiltGcodeSave }
  | { readonly kind: 'direct' }
  | { readonly kind: 'failed' };

export function GcodeSaveDialog(props: { readonly onClose: () => void }): JSX.Element {
  const platform = usePlatform();
  const pushToast = useToastStore((state) => state.pushToast);
  const [ctx] = useState<SaveGcodeCtx>(() => saveContext(platform, pushToast));
  const [preparation, setPreparation] = useState<PreparationState>(() =>
    ordinaryGcodeSaveUsesPrebuiltDialog(ctx.project) ? { kind: 'preparing' } : { kind: 'direct' },
  );

  useEffect(() => {
    if (preparation.kind !== 'preparing') return;
    let current = true;
    void prebuildGcodeSave(ctx)
      .then((artifact) => {
        if (current)
          setPreparation(artifact === null ? { kind: 'failed' } : { kind: 'ready', artifact });
      })
      .catch((error: unknown) => {
        if (!current) return;
        pushToast(`Could not prepare G-code: ${errorMessage(error)}`, 'error');
        setPreparation({ kind: 'failed' });
      });
    return (): void => {
      current = false;
    };
  }, [ctx, preparation.kind, pushToast]);

  const save = (): void => {
    if (preparation.kind === 'preparing' || preparation.kind === 'failed') return;
    const options = preparation.kind === 'ready' ? { prebuilt: preparation.artifact } : undefined;
    void handleSaveGcode(ctx, options).finally(props.onClose);
  };
  return (
    <Dialog title="Save G-code" onClose={props.onClose} size="sm">
      <div className="lf-dialog-body">
        <p>{preparationMessage(preparation)}</p>
      </div>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={preparation.kind === 'preparing' || preparation.kind === 'failed'}
          onClick={save}
        >
          Choose destination…
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function saveContext(
  platform: ReturnType<typeof usePlatform>,
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): SaveGcodeCtx {
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  return {
    platform,
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
    settingsCapability: laser.capabilities.settings,
    activeWcs: laser.activeWcs,
    allowRotaryRaster:
      useExperimentalLaserFeatures.getState().features.rotaryRaster &&
      profileSupportsCapability(app.project.device, 'rotary'),
    advanceVariablesAfter: app.advanceVariablesAfter,
    pushToast,
  };
}

function preparationMessage(state: PreparationState): string {
  switch (state.kind) {
    case 'preparing':
      return 'Preparing the complete export before a final file is selected…';
    case 'ready':
      return 'The complete export is ready. Choose a destination; the final file is written only from this prepared artifact.';
    case 'direct':
      return 'Choose a destination for this prebuilt multi-file or controller-specific export.';
    case 'failed':
      return 'No final file was selected or modified because output preparation did not succeed.';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
