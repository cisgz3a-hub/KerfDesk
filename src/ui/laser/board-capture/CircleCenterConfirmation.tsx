import { useRef, useState } from 'react';
import type { Vec2 } from '../../../core/scene';
import type { BestFitCircle } from '../../../core/scene/board-circle-fit';
import { Button } from '../../kit';
import { inferCurrentMachinePosition } from '../../state/infer-machine-position';
import { useLaserStore } from '../../state/laser-store';
import { BoardFineJogControls } from './BoardFineJogControls';
import { MIN_BOARD_DIMENSION_MM } from './constants';

const CIRCLE_FIT_WARNING_MM = 2;

type CircleCenterConfirmationProps = {
  readonly fit: BestFitCircle;
  readonly livePosition: Vec2 | null;
  readonly disabled: boolean;
  readonly onMoveToPoint: (point: Vec2) => Promise<void>;
  readonly onFinish: (center: Vec2, diameterMm: number) => Promise<void>;
};
type CircleCenterController = {
  readonly moveStarted: boolean;
  readonly settled: boolean;
  readonly saving: boolean;
  readonly cancelling: boolean;
  readonly canCancelMove: boolean;
  readonly error: string | null;
  readonly moveToCenter: () => void;
  readonly cancelMove: () => void;
  readonly createAtCurrentPosition: () => void;
};

export function CircleCenterConfirmation(props: CircleCenterConfirmationProps): JSX.Element {
  const controller = useCircleCenterController(props);
  return (
    <div style={confirmationStyle}>
      <CircleFitSummary fit={props.fit} />
      <CircleCenterAction props={props} controller={controller} />
      {controller.error !== null && (
        <p role="alert" style={warnStyle}>
          {controller.error}
        </p>
      )}
    </div>
  );
}

function useCircleCenterController(props: CircleCenterConfirmationProps): CircleCenterController {
  const statusSequence = useLaserStore((state) => state.statusSequence);
  const cancelJog = useLaserStore((state) => state.cancelJog);
  const canCancelMove = useLaserStore((state) => state.capabilities.jogCancel);
  const activeMoveRequest = useRef(0);
  const [move, setMove] = useState<{
    readonly requestId: number;
    readonly startedAtStatusSequence: number;
    readonly dispatched: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const settled =
    move?.dispatched === true &&
    statusSequence > move.startedAtStatusSequence &&
    !cancelling &&
    !props.disabled &&
    props.livePosition !== null;

  const moveToCenter = (): void => {
    const requestId = activeMoveRequest.current + 1;
    activeMoveRequest.current = requestId;
    const startedAtStatusSequence = useLaserStore.getState().statusSequence;
    setError(null);
    setMove({ requestId, startedAtStatusSequence, dispatched: false });
    void props
      .onMoveToPoint(props.fit.center)
      .then(() => {
        if (activeMoveRequest.current !== requestId) return;
        setMove({ requestId, startedAtStatusSequence, dispatched: true });
      })
      .catch((cause: unknown) => {
        if (activeMoveRequest.current !== requestId) return;
        setMove(null);
        setError(errorMessage(cause, 'Could not move to the calculated circle center.'));
      });
  };

  const cancelMove = (): void => {
    if (move === null || !canCancelMove || cancelling || saving) return;
    setCancelling(true);
    setError(null);
    void cancelJog()
      .then(() => {
        activeMoveRequest.current += 1;
        setMove(null);
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, 'Could not confirm that the center move stopped.'));
      })
      .finally(() => setCancelling(false));
  };

  const createAtCurrentPosition = (): void => {
    if (!settled || saving) return;
    const laser = useLaserStore.getState();
    const currentPosition = inferCurrentMachinePosition(laser.statusReport, laser.wcoCache);
    if (currentPosition === null) {
      setError('A fresh machine position is not available yet. Wait for Idle and try again.');
      return;
    }
    setSaving(true);
    setError(null);
    void props
      .onFinish(currentPosition, props.fit.diameterMm)
      .catch((cause: unknown) =>
        setError(errorMessage(cause, 'Could not create the circle at the current head position.')),
      )
      .finally(() => setSaving(false));
  };

  return {
    moveStarted: move !== null,
    settled,
    saving,
    cancelling,
    canCancelMove,
    error,
    moveToCenter,
    cancelMove,
    createAtCurrentPosition,
  };
}

function CircleFitSummary({ fit }: { readonly fit: BestFitCircle }): JSX.Element {
  return (
    <>
      <div style={measureStyle}>
        Calculated: ⌀ {fit.diameterMm.toFixed(1)} mm; center X {fit.center.x.toFixed(1)} Y{' '}
        {fit.center.y.toFixed(1)}
      </div>
      <p style={mutedStyle}>
        Fit error {fit.rmsErrorMm.toFixed(1)} mm RMS; rim coverage {fit.coverageDeg.toFixed(0)}°.
      </p>
      {fit.maxErrorMm > CIRCLE_FIT_WARNING_MM && (
        <p style={warnStyle}>
          The rim points vary by up to {fit.maxErrorMm.toFixed(1)} mm. Recheck them if the board is
          meant to be round.
        </p>
      )}
      {fit.diameterMm < MIN_BOARD_DIMENSION_MM && (
        <p role="alert" style={warnStyle}>
          That circle is too small — capture a board at least {MIN_BOARD_DIMENSION_MM} mm across.
        </p>
      )}
    </>
  );
}

function CircleCenterAction(props: {
  readonly props: CircleCenterConfirmationProps;
  readonly controller: CircleCenterController;
}): JSX.Element {
  const { controller, props: confirmation } = props;
  if (controller.saving) {
    return (
      <div style={confirmationStyle}>
        <strong>Saving circle center and work origin</strong>
        <p style={stepStyle}>Keep this panel open until the circle outline is created.</p>
      </div>
    );
  }
  if (!controller.moveStarted) {
    return (
      <Button
        variant="primary"
        disabled={confirmation.disabled || confirmation.fit.diameterMm < MIN_BOARD_DIMENSION_MM}
        onClick={controller.moveToCenter}
      >
        Move to calculated center
      </Button>
    );
  }
  if (!controller.settled) {
    return <CircleCenterMovingAction controller={controller} />;
  }
  return (
    <>
      <p style={stepStyle}>
        The head is at the calculated center. Fine-jog if needed, then use its current position.
      </p>
      <BoardFineJogControls disabled={confirmation.disabled || controller.saving} />
      <Button
        variant="primary"
        disabled={
          confirmation.disabled ||
          confirmation.livePosition === null ||
          controller.saving ||
          confirmation.fit.diameterMm < MIN_BOARD_DIMENSION_MM
        }
        onClick={controller.createAtCurrentPosition}
      >
        {controller.saving ? 'Creating…' : 'Use current head position as center'}
      </Button>
    </>
  );
}

function CircleCenterMovingAction(props: {
  readonly controller: CircleCenterController;
}): JSX.Element {
  const { controller } = props;
  return (
    <>
      <p style={stepStyle}>
        {controller.cancelling
          ? 'Stopping the beam-off center move and confirming Idle...'
          : 'Moving beam-off. Wait for the machine to settle at Idle.'}
      </p>
      {controller.canCancelMove ? (
        <Button variant="ghost" disabled={controller.cancelling} onClick={controller.cancelMove}>
          {controller.cancelling ? 'Stopping...' : 'Cancel center move'}
        </Button>
      ) : (
        <p style={warnStyle}>
          This controller cannot stop a dispatched point move. Wait for it to reach Idle.
        </p>
      )}
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
}

const confirmationStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const stepStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const mutedStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const measureStyle: React.CSSProperties = { fontWeight: 600 };
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
