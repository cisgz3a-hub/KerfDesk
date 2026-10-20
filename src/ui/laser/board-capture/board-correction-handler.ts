// board-correction-handler — save a physically checked board point (ADR-124,
// ADR-599, ADR-636): rebuild the board from the confirmed position, set the
// work origin again when the correction moves it, and refuse when the board,
// the project or the machine coordinates changed under the check.

import { findRegistrationBoxes, type Vec2 } from '../../../core/scene';
import {
  boardCorrectionChangesOrigin,
  capturedBoardOrigin,
  capturedBoardShape,
  correctCapturedBoardGeometry,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { useStore } from '../../state';
import {
  currentRegistrationEpoch,
  errorMessage,
  setBoardOrigin,
  type BoardCaptureHandlerArgs,
  type SetMessage,
} from './board-capture-origin';
import { MIN_BOARD_DIMENSION_MM } from './constants';
import { capturedBoardOutlineMatches } from './captured-board-outline';
import type { BoardCapture, BoardRegistrationEpoch } from './use-board-capture';

const CROSS_AXIS_NOTICE_MM = 5;

export function createBoardCorrectionHandler(
  args: BoardCaptureHandlerArgs,
  setError: SetMessage,
  setNotice: SetMessage,
): (target: BoardVerificationTarget, confirmed: Vec2) => Promise<void> {
  return async (target, confirmed) => {
    setError(null);
    setNotice(null);
    try {
      const assertCurrent = boardCorrectionOwner(args.capture);
      const before = args.capture.state.geometry;
      const correction = correctedGeometry(args, target, confirmed);
      const changesOrigin =
        before !== null && boardCorrectionChangesOrigin(before, correction.geometry, target);
      if (changesOrigin) await setBoardOrigin(args, capturedBoardOrigin(correction.geometry));
      const registrationEpoch = assertCurrent(changesOrigin ? 1 : 0);
      args.updateCapturedBoard(capturedBoardShape(correction.geometry));
      args.capture.updateGeometry(correction.geometry, registrationEpoch);
      setCrossAxisNotice(correction.crossAxisErrorMm, setNotice);
    } catch (error) {
      setError(errorMessage(error, 'Could not update the captured board.'));
      throw error;
    }
  };
}

function boardCorrectionOwner(
  capture: BoardCapture,
): (allowedOriginAdvance: number) => BoardRegistrationEpoch {
  const owner = useStore.getState();
  const outline = findRegistrationBoxes(owner.project.scene).find(
    (box) => box.provenance === 'captured-board',
  );
  const registered = capture.state.registrationEpoch;
  if (
    !capture.isSessionCurrent() ||
    outline?.id !== capture.state.outlineId ||
    registered === null ||
    !capturedBoardOutlineMatches(
      owner.project.scene,
      capture.state.outlineId,
      capture.state.geometry,
    )
  ) {
    throw new Error('The captured board changed. Capture the board again before correcting it.');
  }
  return (allowedOriginAdvance) => {
    const current = useStore.getState();
    const currentOutline = findRegistrationBoxes(current.project.scene).find(
      (box) => box.provenance === 'captured-board',
    );
    if (
      !capture.isSessionCurrent() ||
      current.projectDocumentEpoch !== owner.projectDocumentEpoch ||
      currentOutline !== outline
    ) {
      throw new Error('The captured board changed. Capture the board again before correcting it.');
    }
    const epoch = currentRegistrationEpoch();
    // Setting this correction's origin may advance its version once. Other
    // coordinate/session changes cannot transfer ownership to this completion.
    const originAdvance = epoch.workOriginVersion - registered.workOriginVersion;
    if (
      epoch.controllerSessionEpoch !== registered.controllerSessionEpoch ||
      epoch.trustedPositionEpoch !== registered.trustedPositionEpoch ||
      originAdvance < 0 ||
      originAdvance > allowedOriginAdvance
    ) {
      throw new Error('Machine coordinates changed. Capture the board again before correcting it.');
    }
    return epoch;
  };
}

function correctedGeometry(
  args: BoardCaptureHandlerArgs,
  target: BoardVerificationTarget,
  confirmed: Vec2,
) {
  assertRegistrationEpoch(args.capture, currentRegistrationEpoch());
  const geometry = args.capture.state.geometry;
  if (geometry === null) throw new Error('Capture a board before checking its points.');
  const correction = correctCapturedBoardGeometry(geometry, target, confirmed);
  if (correction === null || !largeEnough(correction.geometry)) {
    throw new Error('That correction would make the board invalid or too small.');
  }
  return correction;
}

function setCrossAxisNotice(errorMm: number, setNotice: SetMessage): void {
  if (errorMm <= CROSS_AXIS_NOTICE_MM) return;
  setNotice(
    `Point saved, but it was ${errorMm.toFixed(1)} mm off the expected axis. ` +
      'Check that the intended board point matches the selected verification point.',
  );
}

function largeEnough(geometry: CapturedBoardGeometry): boolean {
  switch (geometry.kind) {
    case 'rect':
      return (
        geometry.widthMm >= MIN_BOARD_DIMENSION_MM && geometry.heightMm >= MIN_BOARD_DIMENSION_MM
      );
    case 'circle':
      return geometry.radiusMm * 2 >= MIN_BOARD_DIMENSION_MM;
    case 'polygon':
      return (
        geometry.polygon.widthMm >= MIN_BOARD_DIMENSION_MM &&
        geometry.polygon.heightMm >= MIN_BOARD_DIMENSION_MM
      );
  }
}

function assertRegistrationEpoch(capture: BoardCapture, current: BoardRegistrationEpoch): void {
  const registered = capture.state.registrationEpoch;
  if (
    registered === null ||
    registered.controllerSessionEpoch !== current.controllerSessionEpoch ||
    registered.trustedPositionEpoch !== current.trustedPositionEpoch ||
    registered.workOriginVersion !== current.workOriginVersion
  ) {
    throw new Error('Machine coordinates changed. Capture the board again before checking it.');
  }
}
