import { lazy, Suspense, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useToastStore } from '../state/toast-store';
import {
  buildPhotoEngravingUpdate,
  photoEngravingImage,
  photoEngravingPatchIsValid,
  type PhotoEngravingApply,
} from './photo-engraving-apply';
import {
  photoEngravingSessionIsCurrent,
  usePhotoEngravingStore,
  type PhotoEngravingSession,
} from './photo-engraving-store';

const PhotoEngravingDialog = lazy(() => import('./PhotoEngravingDialog'));

export function PhotoEngravingDialogHost(): JSX.Element | null {
  const session = usePhotoEngravingStore((state) => state.session);
  if (session === null) return null;
  return <OwnedPhotoEngravingDialog key={session.sessionId} session={session} />;
}

function OwnedPhotoEngravingDialog({
  session,
}: {
  readonly session: PhotoEngravingSession;
}): JSX.Element {
  const close = (): void => usePhotoEngravingStore.getState().close(session);
  const current = useStore((state) => photoEngravingSessionIsCurrent(state, session));
  const [error, setError] = useState<string | null>(null);
  const apply = (patch: PhotoEngravingApply): void => {
    if (!photoEngravingPatchIsValid(patch)) {
      setError('Enter valid photo tones and a positive engraving resolution.');
      return;
    }
    let applied = false;
    useStore.setState((state) => {
      if (
        usePhotoEngravingStore.getState().session !== session ||
        !photoEngravingSessionIsCurrent(state, session)
      )
        return state;
      const update = buildPhotoEngravingUpdate(state, session, patch);
      if (update === null) {
        applied =
          photoEngravingSessionIsCurrent(state, session) &&
          photoEngravingImage(session.image, session.operation, patch) === session.image;
        return state;
      }
      applied = true;
      return update;
    });
    if (!applied) {
      setError('The photo or operation changed. Close this window and open Photo engraving again.');
      return;
    }
    close();
    useToastStore
      .getState()
      .pushToast('Photo engraving settings applied to the selected photo.', 'success');
  };
  return (
    <Suspense fallback={<LoadingPhotoDialog onClose={close} />}>
      <PhotoEngravingDialog
        session={session}
        current={current}
        error={error}
        onCancel={close}
        onApply={apply}
        onEditSource={() => {
          if (!current) return;
          close();
          void useImageEditorStore.getState().openEditor(session.image);
        }}
      />
    </Suspense>
  );
}

function LoadingPhotoDialog({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <Dialog title="Photo engraving" onClose={onClose}>
      <p role="status">Opening photo tools…</p>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
