const JOG_METHOD_LABEL = 'Jog with controls';
const SELECTED_LABEL = 'Selected';
const JOG_INSTRUCTION =
  'Jog to the job anchor with the arrows. Frame to confirm the area, then Start.';
const CHOOSE_JOG_LABEL = 'Choose jog positioning';
const CHOOSE_JOG_TITLE =
  'Select jog positioning. The live head position is read when Frame and Start run.';
const RELEASE_MOTORS_LABEL = 'Release motors to move by hand';
const RELEASING_MOTORS_LABEL = 'Releasing motors...';
const RELEASE_MOTORS_TITLE = 'Release the motors before physically moving the laser head.';
const NO_SLEEP_COMMAND_TITLE = 'Controller has no sleep command.';

/** Renders the normal jog choice and the motor-release entry to hand positioning. */
export function NoHomingPositionChoices(props: {
  readonly disabled: boolean;
  readonly canSleep: boolean;
  readonly error: string | null;
  readonly releasing: boolean;
  readonly isJogPositioning: boolean;
  readonly onChooseJog: () => void;
  readonly onRelease: () => void;
}): JSX.Element {
  return (
    <>
      <div style={methodStyle}>
        <div style={methodHeadingStyle}>
          <strong>{JOG_METHOD_LABEL}</strong>
          {props.isJogPositioning && <span style={selectedStyle}>{SELECTED_LABEL}</span>}
        </div>
        <p style={messageStyle}>{JOG_INSTRUCTION}</p>
        {!props.isJogPositioning && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onChooseJog}
            title={CHOOSE_JOG_TITLE}
          >
            {CHOOSE_JOG_LABEL}
          </button>
        )}
      </div>
      <button
        type="button"
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

const messageStyle: React.CSSProperties = { margin: '4px 0 6px', fontSize: 12 };
const errorStyle: React.CSSProperties = { ...messageStyle, color: 'var(--lf-danger-fg)' };
const methodStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
  margin: '4px 0 6px',
};
const methodHeadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};
const selectedStyle: React.CSSProperties = {
  color: 'var(--lf-success-fg)',
  fontSize: 11,
};
