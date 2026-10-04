import { Button, Dialog, DialogActions } from '../kit';
import { useProjectSaveDialogStore } from '../state/project-save-dialog-store';

export function ProjectSaveDialog(): JSX.Element | null {
  const request = useProjectSaveDialogStore((state) => state.request);
  if (request === null) return null;
  const choosing = request.phase === 'choosing';
  const recovery = request.purpose === 'recovery';
  return (
    <Dialog
      title={recovery ? 'Export recovery copy' : 'Save project'}
      size="sm"
      onClose={choosing ? () => undefined : request.cancel}
    >
      <div className="lf-dialog-body" aria-live="polite">
        <p>
          {request.phase === 'preparing'
            ? `Preparing ${request.projectName}…`
            : request.phase === 'ready'
              ? recovery
                ? 'The raw recovery copy is ready. Choose a new file. It may need repair before it reopens cleanly; your project stays unsaved.'
                : 'Your project is ready. Choose a filename and folder to save it.'
              : 'Choose a destination in the file dialog.'}
        </p>
      </div>
      <DialogActions>
        <Button disabled={choosing} onClick={request.cancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={request.phase !== 'ready'} onClick={request.choose}>
          {recovery ? 'Choose recovery file…' : 'Choose file…'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
