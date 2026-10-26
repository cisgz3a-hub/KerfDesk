import { Button, Dialog, DialogActions } from '../kit';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';

export function SaveReadyDialog(): JSX.Element | null {
  const request = useSaveReadyDialogStore((state) => state.request);
  if (request === null) return null;
  const choosing = request.phase === 'choosing';
  return (
    <Dialog title={request.title} size="sm" onClose={choosing ? () => undefined : request.cancel}>
      <div className="lf-dialog-body" aria-live="polite">
        <p>
          {choosing
            ? 'Choose a destination in the file dialog.'
            : `${request.message} Choose a filename and folder to save it.`}
        </p>
      </div>
      <DialogActions>
        <Button disabled={choosing} onClick={request.cancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={choosing} onClick={request.choose}>
          Choose file…
        </Button>
      </DialogActions>
    </Dialog>
  );
}
