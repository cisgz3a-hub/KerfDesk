import { useEffect, useState } from 'react';
import { useBoardPhotoInbox } from './board-capture-remote';
import type { BoardCapture } from './use-board-capture';

export function usePendingBoardPhoto(
  capture: BoardCapture,
  committed: boolean,
  motionActive: boolean,
): {
  readonly initialFile: File | undefined;
  readonly waitingWhileCommitted: boolean;
  readonly consumeInitialFile: () => void;
} {
  const waitingPhoto = useBoardPhotoInbox((state) => state.photo);
  const [initialFile, setInitialFile] = useState<File>();
  useEffect(() => {
    if (waitingPhoto === null || committed || motionActive) return;
    const photo = useBoardPhotoInbox.getState().take();
    if (photo === null) return;
    if (capture.state.shapeKind !== 'outline') capture.setShape('outline');
    setInitialFile(photo);
  }, [capture, committed, motionActive, waitingPhoto]);
  return {
    initialFile,
    waitingWhileCommitted: waitingPhoto !== null && committed,
    consumeInitialFile: () => setInitialFile(undefined),
  };
}
