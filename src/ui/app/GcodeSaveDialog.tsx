import { recordCncPreparation } from '../state/cnc-preparation-evidence-store';
import { CncSetupDocumentExport } from './CncSetupDocumentExport';
import { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { usePlatform } from './platform-context';
import { currentSaveGcodeContext } from './save-gcode-context';
import {
  handleSaveGcode,
  ordinaryGcodeSaveUsesPrebuiltDialog,
  prebuildGcodeSave,
  type PrebuiltGcodeSave,
  type SaveGcodeCtx,
} from './file-actions';
import { errorMessage } from '../../core/util/error-message';

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
        if (current && artifact !== null)
          recordCncPreparation(artifact.project, ctx.outputScope, 'Export');
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
        {preparation.kind === 'ready' ? (
          <CncSetupDocumentExport
            artifact={preparation.artifact}
            ctx={ctx}
            onSaved={props.onClose}
          />
        ) : null}
      </div>
      <DialogActions>
        <Button onClick={props.onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={preparation.kind === 'preparing' || preparation.kind === 'failed'}
          onClick={save}
        >
          Save as…
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
  return {
    ...currentSaveGcodeContext({ platform, app, laser: useLaserStore.getState(), pushToast }),
    advanceVariablesAfter: app.advanceVariablesAfter,
  };
}

function preparationMessage(state: PreparationState): string {
  switch (state.kind) {
    case 'preparing':
      return 'Preparing your G-code file…';
    case 'ready':
      return 'The complete export is ready. Choose a filename and folder, such as Downloads or Desktop. You can create a new file.';
    case 'direct':
      return 'Choose a destination for this prebuilt multi-file or controller-specific export.';
    case 'failed':
      return 'No final file was selected or modified because output preparation did not succeed.';
  }
}
