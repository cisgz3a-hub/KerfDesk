import { lazy, Suspense } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { closePhotoTestCard, usePhotoTestCardStore } from './photo-test-card-store';

// The dialog and the card generator load on demand, as Photo engraving does.
const PhotoTestCardSession = lazy(() => import('./PhotoTestCardSession'));

/** ADR-711: Tools → Calibrate → Photo Test Card, and Photo engraving's "Burn a test card…". */
export function PhotoTestCardDialogHost(): JSX.Element | null {
  const session = usePhotoTestCardStore((state) => state.session);
  if (session === null) return null;
  return (
    <Suspense fallback={<LoadingPhotoTestCard />}>
      <PhotoTestCardSession key={session.sessionId} session={session} />
    </Suspense>
  );
}

function LoadingPhotoTestCard(): JSX.Element {
  return (
    <Dialog title="Photo Test Card" onClose={closePhotoTestCard}>
      <p role="status">Opening the photo test card…</p>
      <DialogActions>
        <Button onClick={closePhotoTestCard}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
