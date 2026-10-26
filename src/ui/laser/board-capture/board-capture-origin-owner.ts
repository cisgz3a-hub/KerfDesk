import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import type { BoardCapture } from './use-board-capture';

/** Bind a calculated board origin to the captures and document that produced it. */
export function boardCaptureOriginOwner(capture: BoardCapture): {
  readonly assertBeforeWrite: () => void;
  readonly assertAfterWrite: () => void;
} {
  const documentEpoch = useStore.getState().projectDocumentEpoch;
  const captured = capture.state.captureEpoch;
  const assertOwned = (originAdvances: number): void => {
    if (!capture.isSessionCurrent() || useStore.getState().projectDocumentEpoch !== documentEpoch) {
      throw new Error('The board capture changed. Start over and capture it again.');
    }
    const current = useLaserStore.getState();
    const advance = (current.workOriginVersion ?? 0) - (captured?.workOriginVersion ?? 0);
    if (
      captured === null ||
      current.controllerSessionEpoch !== captured.controllerSessionEpoch ||
      (current.trustedPositionEpoch ?? 0) !== captured.trustedPositionEpoch ||
      advance < 0 ||
      advance > originAdvances
    ) {
      throw new Error(
        'Machine coordinates changed during capture. Start over and capture it again.',
      );
    }
  };
  return {
    assertBeforeWrite: () => assertOwned(0),
    // Only this registration's acknowledged origin may advance the version.
    assertAfterWrite: () => assertOwned(1),
  };
}
