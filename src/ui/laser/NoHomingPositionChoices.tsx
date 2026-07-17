// The plain-language entry into hand positioning (ADR-225). The old
// "Jog with controls / Choose jog positioning" method card duplicated the
// Start-from dropdown's Current Position option and read as a mystery step;
// jog placement now lives solely in the placement block above.
const HAND_POSITION_INSTRUCTION =
  'No homing switches, so the app only knows a position you give it. ' +
  'Jog with the arrows, or release the motors and push the head by hand — then set the origin.';
const RELEASE_MOTORS_LABEL = 'Release motors to move by hand';
const RELEASING_MOTORS_LABEL = 'Releasing motors...';
const RELEASE_MOTORS_TITLE = 'Release the motors before physically moving the laser head.';
const NO_SLEEP_COMMAND_TITLE = 'Controller has no sleep command.';

/** Renders the motor-release entry to hand positioning. */
export function NoHomingPositionChoices(props: {
  readonly disabled: boolean;
  readonly canSleep: boolean;
  readonly error: string | null;
  readonly releasing: boolean;
  readonly onRelease: () => void;
}): JSX.Element {
  return (
    <>
      <p style={messageStyle}>{HAND_POSITION_INSTRUCTION}</p>
      <button
        type="button"
        className="lf-btn"
        style={choiceButtonStyle}
        disabled={props.disabled || !props.canSleep}
        onClick={props.onRelease}
        title={props.canSleep ? RELEASE_MOTORS_TITLE : NO_SLEEP_COMMAND_TITLE}
      >
        {props.releasing ? RELEASING_MOTORS_LABEL : RELEASE_MOTORS_LABEL}
      </button>
      {props.error !== null && <p style={errorStyle}>{props.error}</p>}
    </>
  );
}

const messageStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const errorStyle: React.CSSProperties = { ...messageStyle, color: 'var(--lf-danger-fg)' };
const choiceButtonStyle: React.CSSProperties = { width: '100%' };
