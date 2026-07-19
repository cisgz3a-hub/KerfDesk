import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Vec2 } from '../../../core/scene';
import {
  boardVerificationPoint,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { jogFrameCommandBlockMessage } from '../../state/laser-store-helpers';
import type { BoardRegistrationEpoch } from './use-board-capture';

type VerificationSession = {
  readonly requestId: number;
  readonly target: BoardVerificationTarget;
  readonly startedAtStatusSequence: number;
  readonly moveDispatched: boolean;
  readonly adjusting: boolean;
};
type BoardVerificationArgs = {
  readonly geometry: CapturedBoardGeometry | null;
  readonly registrationEpoch: BoardRegistrationEpoch | null;
  readonly currentEpoch: BoardRegistrationEpoch;
  readonly outlineValid?: boolean;
  readonly feed: number;
  readonly disabled: boolean;
  readonly onCorrect: (target: BoardVerificationTarget, position: Vec2) => Promise<void>;
};
type VerificationState = {
  readonly session: VerificationSession | null;
  readonly setSession: Dispatch<SetStateAction<VerificationSession | null>>;
  readonly error: string | null;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly feedback: string | null;
  readonly setFeedback: Dispatch<SetStateAction<string | null>>;
  readonly saving: boolean;
  readonly setSaving: Dispatch<SetStateAction<boolean>>;
  readonly cancelling: boolean;
  readonly setCancelling: Dispatch<SetStateAction<boolean>>;
  readonly nextRequestId: MutableRefObject<number>;
};

export type BoardVerificationController = {
  readonly activeTarget: BoardVerificationTarget | null;
  readonly ready: boolean;
  readonly adjusting: boolean;
  readonly saving: boolean;
  readonly cancelling: boolean;
  readonly canCancelMove: boolean;
  readonly epochValid: boolean;
  readonly error: string | null;
  readonly feedback: string | null;
  readonly selectTarget: (target: BoardVerificationTarget) => void;
  readonly acceptTarget: () => void;
  readonly adjustTarget: () => void;
  readonly confirmCurrentPosition: () => void;
  readonly cancel: () => void;
};

export function useBoardVerification(args: BoardVerificationArgs): BoardVerificationController {
  const jogToMachinePosition = useLaserStore((state) => state.jogToMachinePosition);
  const cancelJog = useLaserStore((state) => state.cancelJog);
  const canCancelMove = useLaserStore((state) => state.capabilities.jogCancel);
  const statusSequence = useLaserStore((state) => state.statusSequence);
  const state = useVerificationState();
  const epochValid =
    args.outlineValid !== false &&
    registrationEpochMatches(args.registrationEpoch, args.currentEpoch);
  const ready = verificationReady(
    state.session,
    statusSequence,
    args.disabled,
    epochValid,
    state.cancelling,
  );
  const decisions = createDecisionActions(state, ready);
  return {
    activeTarget: state.session?.target ?? null,
    ready,
    adjusting: state.session?.adjusting ?? false,
    saving: state.saving,
    cancelling: state.cancelling,
    canCancelMove,
    epochValid,
    error: state.error,
    feedback: state.feedback,
    selectTarget: createMoveAction(args, state, jogToMachinePosition),
    ...decisions,
    confirmCurrentPosition: createCorrectionAction(args, state, ready),
    cancel: createCancelAction(state, cancelJog, canCancelMove),
  };
}

function useVerificationState(): VerificationState {
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const nextRequestId = useRef(0);
  return {
    session,
    setSession,
    error,
    setError,
    feedback,
    setFeedback,
    saving,
    setSaving,
    cancelling,
    setCancelling,
    nextRequestId,
  };
}

function createMoveAction(
  args: BoardVerificationArgs,
  state: VerificationState,
  jog: (x: number, y: number, feed: number) => Promise<void>,
): BoardVerificationController['selectTarget'] {
  return (target) => {
    const point = args.geometry === null ? null : boardVerificationPoint(args.geometry, target);
    if (
      point === null ||
      args.outlineValid === false ||
      !registeredEpochIsLive(args.registrationEpoch)
    ) {
      state.setError(staleRegistrationMessage());
      return;
    }
    const blockReason = verificationBlockReason();
    if (blockReason !== null) {
      state.setError(blockReason);
      return;
    }
    const requestId = state.nextRequestId.current + 1;
    state.nextRequestId.current = requestId;
    state.setError(null);
    state.setFeedback(null);
    state.setSession(newVerificationSession(requestId, target));
    void jog(point.x, point.y, args.feed)
      .then(() => markMoveDispatched(state, requestId))
      .catch((cause: unknown) => reportMoveFailure(state, requestId, cause));
  };
}

function createDecisionActions(
  state: VerificationState,
  ready: boolean,
): Pick<BoardVerificationController, 'acceptTarget' | 'adjustTarget'> {
  return {
    acceptTarget: () => {
      if (state.session === null || !ready || !liveActionReady(state.setError)) return;
      state.setFeedback(`${boardVerificationTargetLabel(state.session.target)} confirmed.`);
      state.setError(null);
      state.setSession(null);
    },
    adjustTarget: () => {
      if (!ready || !liveActionReady(state.setError)) return;
      state.setSession((current) => (current === null ? null : { ...current, adjusting: true }));
    },
  };
}

function createCorrectionAction(
  args: BoardVerificationArgs,
  state: VerificationState,
  ready: boolean,
): BoardVerificationController['confirmCurrentPosition'] {
  return () => {
    if (state.session === null || !state.session.adjusting || !ready || state.saving) return;
    if (!liveActionReady(state.setError)) return;
    if (args.outlineValid === false || !registeredEpochIsLive(args.registrationEpoch)) {
      state.setError(staleRegistrationMessage());
      return;
    }
    const position = currentMachinePosition();
    if (position === null) {
      state.setError('A fresh machine position is not available yet. Wait for Idle and try again.');
      return;
    }
    saveCorrection(args, state, state.session.target, position);
  };
}

function saveCorrection(
  args: BoardVerificationArgs,
  state: VerificationState,
  target: BoardVerificationTarget,
  position: Vec2,
): void {
  state.setSaving(true);
  state.setError(null);
  void args
    .onCorrect(target, position)
    .then(() => {
      state.setFeedback(
        `${boardVerificationTargetLabel(target)} updated from the current head position.`,
      );
      state.setSession(null);
    })
    .catch((cause: unknown) => {
      state.setError(errorMessage(cause, 'Could not update that board point.'));
    })
    .finally(() => state.setSaving(false));
}

function createCancelAction(
  state: VerificationState,
  cancelJog: () => Promise<void>,
  canCancelMove: boolean,
): () => void {
  return () => {
    const session = state.session;
    if (session === null || state.cancelling || state.saving) return;
    state.setError(null);
    const moving = useLaserStore.getState().motionOperation?.kind === 'jog';
    if (!moving) {
      state.nextRequestId.current += 1;
      state.setSession(null);
      return;
    }
    if (!canCancelMove) {
      state.setError(
        'This controller cannot stop a dispatched point move. Wait for it to reach Idle.',
      );
      return;
    }
    state.nextRequestId.current += 1;
    state.setCancelling(true);
    void cancelJog()
      .then(() => {
        state.setSession((current) => (current?.requestId === session.requestId ? null : current));
      })
      .catch((cause: unknown) => {
        state.setError(errorMessage(cause, 'Could not confirm that the board-point move stopped.'));
      })
      .finally(() => state.setCancelling(false));
  };
}

function newVerificationSession(
  requestId: number,
  target: BoardVerificationTarget,
): VerificationSession {
  return {
    requestId,
    target,
    startedAtStatusSequence: useLaserStore.getState().statusSequence,
    moveDispatched: false,
    adjusting: false,
  };
}

function markMoveDispatched(state: VerificationState, requestId: number): void {
  if (state.nextRequestId.current !== requestId) return;
  state.setSession((current) =>
    current?.requestId === requestId ? { ...current, moveDispatched: true } : current,
  );
}

function reportMoveFailure(state: VerificationState, requestId: number, cause: unknown): void {
  if (state.nextRequestId.current !== requestId) return;
  state.setSession(null);
  state.setError(errorMessage(cause, 'Could not move to that board point.'));
}

function verificationReady(
  session: VerificationSession | null,
  statusSequence: number,
  disabled: boolean,
  epochValid: boolean,
  cancelling: boolean,
): boolean {
  return (
    session !== null &&
    session.moveDispatched &&
    statusSequence > session.startedAtStatusSequence &&
    !disabled &&
    !cancelling &&
    currentMachinePosition() !== null &&
    epochValid
  );
}

export function boardVerificationTargetLabel(target: BoardVerificationTarget): string {
  switch (target.anchor) {
    case 'bottom-left':
      return 'Bottom-left corner';
    case 'bottom-right':
      return 'Bottom-right corner';
    case 'top-left':
      return 'Top-left corner';
    case 'top-right':
      return 'Top-right corner';
    case 'center':
      return 'Circle center';
    case 'rim-top':
      return 'Top rim';
    case 'rim-right':
      return 'Right rim';
    case 'rim-bottom':
      return 'Bottom rim';
    case 'rim-left':
      return 'Left rim';
  }
}

function currentMachinePosition(): Vec2 | null {
  const laser = useLaserStore.getState();
  return inferCurrentMachinePosition(laser.statusReport, laser.wcoCache);
}

function currentRegistrationEpoch(): BoardRegistrationEpoch {
  const laser = useLaserStore.getState();
  return {
    controllerSessionEpoch: laser.controllerSessionEpoch,
    trustedPositionEpoch: laser.trustedPositionEpoch ?? 0,
    workOriginVersion: laser.workOriginVersion ?? 0,
  };
}

function registeredEpochIsLive(registered: BoardRegistrationEpoch | null): boolean {
  return registrationEpochMatches(registered, currentRegistrationEpoch());
}

function liveActionReady(setError: VerificationState['setError']): boolean {
  const reason = verificationBlockReason();
  if (reason === null) return true;
  setError(reason);
  return false;
}

function verificationBlockReason(): string | null {
  const laser = useLaserStore.getState();
  if (laser.connection.kind !== 'connected')
    return 'Connect the machine before checking a board point.';
  if (laser.autofocusBusy) return 'Wait for autofocus to finish.';
  if (laser.pendingUntrackedAcks > 0 || (laser.pendingTransportWrites ?? 0) > 0) {
    return 'Wait for the previous controller command to settle.';
  }
  return jogFrameCommandBlockMessage(laser);
}

function registrationEpochMatches(
  registered: BoardRegistrationEpoch | null,
  current: BoardRegistrationEpoch,
): boolean {
  return (
    registered !== null &&
    registered.controllerSessionEpoch === current.controllerSessionEpoch &&
    registered.trustedPositionEpoch === current.trustedPositionEpoch &&
    registered.workOriginVersion === current.workOriginVersion
  );
}

function staleRegistrationMessage(): string {
  return 'The board outline or machine coordinates changed. Capture the board again before checking it.';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}
