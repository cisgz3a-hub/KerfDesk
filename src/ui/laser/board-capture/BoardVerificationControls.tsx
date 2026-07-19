import {
  CIRCLE_BOARD_VERIFICATION_ANCHORS,
  RECTANGLE_BOARD_VERIFICATION_ANCHORS,
  type BoardVerificationTarget,
  type CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { Button } from '../../kit';
import { BoardFineJogControls } from './BoardFineJogControls';
import {
  boardVerificationTargetLabel,
  type BoardVerificationController,
} from './use-board-verification';

export function BoardVerificationControls(props: {
  readonly geometry: CapturedBoardGeometry;
  readonly disabled: boolean;
  readonly controller: BoardVerificationController;
}): JSX.Element {
  const targets = verificationTargets(props.geometry);
  const active = props.controller.activeTarget;
  const checksDisabled = props.disabled || !props.controller.epochValid || active !== null;

  return (
    <section aria-label="Physically check board" style={sectionStyle}>
      <p style={hintStyle}>
        Check the physical board: choose a highlighted point on the outline or a button below. Zoom
        in or use the buttons when points are crowded.
      </p>
      <div aria-label="Board check points" role="group" style={buttonRowStyle}>
        {targets.map((target) => (
          <Button
            key={target.anchor}
            disabled={checksDisabled}
            title={`Move the laser head beam-off to the ${boardVerificationTargetLabel(target).toLowerCase()}`}
            onClick={() => props.controller.selectTarget(target)}
          >
            {shortTargetLabel(target)}
          </Button>
        ))}
      </div>
      {!props.controller.epochValid && (
        <p role="alert" style={warningStyle}>
          The board outline or machine coordinates changed. Capture the board again before checking
          its points.
        </p>
      )}
      {active !== null && (
        <ActiveVerification
          target={active}
          disabled={props.disabled}
          controller={props.controller}
        />
      )}
      <div aria-live="polite" aria-atomic="true" style={liveRegionStyle}>
        {props.controller.error ?? props.controller.feedback}
      </div>
    </section>
  );
}

function ActiveVerification(props: {
  readonly target: BoardVerificationTarget;
  readonly disabled: boolean;
  readonly controller: BoardVerificationController;
}): JSX.Element {
  const label = boardVerificationTargetLabel(props.target).toLowerCase();
  if (props.controller.saving) {
    return <SavingVerification label={label} />;
  }
  if (!props.controller.ready) {
    return (
      <div style={activeStyle}>
        <strong>Checking {label}</strong>
        <p style={hintStyle}>
          {props.controller.cancelling
            ? 'Stopping the beam-off move and confirming Idle...'
            : 'Moving beam-off. Wait for the machine to settle at Idle.'}
        </p>
        {props.controller.canCancelMove ? (
          <Button
            variant="ghost"
            disabled={props.controller.cancelling}
            onClick={props.controller.cancel}
          >
            {props.controller.cancelling ? 'Stopping...' : 'Cancel check'}
          </Button>
        ) : (
          <p style={warningStyle}>
            This controller cannot stop a dispatched point move. Wait for it to reach Idle.
          </p>
        )}
      </div>
    );
  }
  if (props.controller.adjusting) {
    return (
      <div style={activeStyle}>
        <strong>Adjust the {label}</strong>
        <p style={hintStyle}>Fine-jog until the laser head is exactly on the physical point.</p>
        <BoardFineJogControls disabled={props.disabled || props.controller.saving} />
        <div style={buttonRowStyle}>
          <Button
            variant="primary"
            disabled={props.disabled || props.controller.saving}
            onClick={props.controller.confirmCurrentPosition}
          >
            {props.controller.saving ? 'Updating…' : 'Use current head position & update board'}
          </Button>
          <Button
            variant="ghost"
            disabled={props.controller.saving}
            onClick={props.controller.cancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div style={activeStyle}>
      <strong>Is the laser head on the physical {label}?</strong>
      <div style={buttonRowStyle}>
        <Button variant="primary" onClick={props.controller.acceptTarget}>
          Yes, correct
        </Button>
        <Button onClick={props.controller.adjustTarget}>No, adjust it</Button>
        <Button variant="ghost" onClick={props.controller.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SavingVerification({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={activeStyle}>
      <strong>Saving the corrected {label}</strong>
      <p style={hintStyle}>
        Keep this panel open while the board geometry and work origin are updated.
      </p>
    </div>
  );
}

function verificationTargets(
  geometry: CapturedBoardGeometry,
): ReadonlyArray<BoardVerificationTarget> {
  return geometry.kind === 'rect'
    ? RECTANGLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'rect', anchor }))
    : CIRCLE_BOARD_VERIFICATION_ANCHORS.map((anchor) => ({ kind: 'circle', anchor }));
}

function shortTargetLabel(target: BoardVerificationTarget): string {
  switch (target.anchor) {
    case 'bottom-left':
      return 'Btm-left';
    case 'bottom-right':
      return 'Btm-right';
    case 'top-left':
      return 'Top-left';
    case 'top-right':
      return 'Top-right';
    case 'center':
      return 'Center';
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

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 6,
  borderTop: '1px solid var(--lf-border)',
};
const activeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  border: '1px solid var(--lf-accent)',
  borderRadius: 6,
};
const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const warningStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-warning-fg)',
};
const liveRegionStyle: React.CSSProperties = {
  minHeight: 16,
  fontSize: 12,
  lineHeight: 1.3,
  color: 'var(--lf-text-muted)',
};
