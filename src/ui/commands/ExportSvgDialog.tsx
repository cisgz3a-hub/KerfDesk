// Options for File > Export artwork as SVG (ADR-451): Group islands puts each
// filled shape and its holes in their own <g> (exportSceneSvg groupContours).
// Choose File... opens the save picker inside the submit click, so the
// browser's user activation still covers it.

import { useState } from 'react';
import type { PlatformAdapter } from '../../platform/types';
import { handleExportArtworkSvg } from '../app/export-artwork-svg';
import { usePlatform } from '../app/platform-context';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useToastStore, type ToastVariant } from '../state/toast-store';
import { useExportSvgDialogStore } from './export-svg-dialog-store';
import { selectedObjectIds } from './selection-command-state';

export function ExportSvgDialog(props: {
  readonly initialGroupIslands: boolean;
  readonly onCancel: () => void;
  readonly onExport: (options: { readonly groupIslands: boolean }) => void;
}): JSX.Element {
  const [groupIslands, setGroupIslands] = useState(props.initialGroupIslands);
  return (
    <Dialog
      title="Export SVG"
      size="sm"
      onClose={props.onCancel}
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onExport({ groupIslands });
      }}
    >
      <label className="lf-field">
        <input
          type="checkbox"
          checked={groupIslands}
          title="Put each filled shape and its holes in their own group so editors select them together."
          onChange={(event) => setGroupIslands(event.currentTarget.checked)}
        />
        <span>Group islands</span>
      </label>
      <div className="lf-dialog-body">
        <p>Exports the selected artwork, or all artwork when nothing is selected.</p>
      </div>
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button variant="primary" type="submit">
          Choose File...
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ExportSvgDialogHost(): JSX.Element | null {
  const open = useExportSvgDialogStore((s) => s.open);
  const groupIslands = useExportSvgDialogStore((s) => s.groupIslands);
  const platform = usePlatform();
  const pushToast = useToastStore((s) => s.pushToast);
  if (!open) return null;
  const close = (): void => useExportSvgDialogStore.getState().close();
  return (
    <ExportSvgDialog
      initialGroupIslands={groupIslands}
      onCancel={close}
      onExport={(options) => {
        useExportSvgDialogStore.getState().rememberGroupIslands(options.groupIslands);
        close();
        exportSvgFromStore(platform, pushToast, options.groupIslands);
      }}
    />
  );
}

/** Export the artwork as it stands at the click (ADR-403 capture rule). */
export function exportSvgFromStore(
  platform: PlatformAdapter,
  pushToast: (message: string, variant?: ToastVariant) => void,
  groupIslands: boolean,
): void {
  const current = useStore.getState();
  void handleExportArtworkSvg({
    platform,
    project: current.project,
    selectedIds: selectedObjectIds(current.selectedObjectId, current.additionalSelectedIds),
    savedName: current.savedName,
    pushToast,
    ...(groupIslands ? { groupContours: true } : {}),
  });
}
