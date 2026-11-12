import { Button, Dialog, DialogActions } from '../kit';
import {
  useSaveReadyDialogStore,
  type SaveReadyDialogRequest,
} from '../state/save-ready-dialog-store';

export function SaveReadyDialog(): JSX.Element | null {
  const request = useSaveReadyDialogStore((state) => state.request);
  if (request === null) return null;
  const choosing = request.phase === 'choosing';
  const opens = request.picks === 'open';
  return (
    <Dialog title={request.title} size="sm" onClose={choosing ? () => undefined : request.cancel}>
      <div className="lf-dialog-body" aria-live="polite">
        <p>{bodyText(request)}</p>
      </div>
      <DialogActions>
        {/* An Open continues on Enter: Choose file… takes the first focus, and
            Escape still cancels (ADR-656 Amendment 5). */}
        <Button
          disabled={choosing}
          onClick={request.cancel}
          {...(opens ? { 'data-dialog-secondary-focus': '' } : {})}
        >
          Cancel
        </Button>
        <Button variant="primary" disabled={choosing} onClick={request.choose}>
          Choose file…
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function bodyText(request: SaveReadyDialogRequest): string {
  if (request.picks === 'open')
    return request.phase === 'choosing' ? 'Choose the file in the file dialog.' : request.message;
  return request.phase === 'choosing'
    ? 'Choose a destination in the file dialog.'
    : `${request.message} Choose a filename and folder to save it.`;
}
