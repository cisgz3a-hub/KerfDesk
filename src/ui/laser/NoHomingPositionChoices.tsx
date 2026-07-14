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
          <strong>Jog with controls</strong>
          {props.isJogPositioning && <span style={selectedStyle}>Selected</span>}
        </div>
        <p style={messageStyle}>
          Jog to the job anchor with the arrows. Frame to confirm the area, then Start.
        </p>
        {!props.isJogPositioning && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onChooseJog}
            title="Select jog positioning. The live head position is read when Frame and Start run."
          >
            Choose jog positioning
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={props.disabled || !props.canSleep}
        onClick={props.onRelease}
        title={
          props.canSleep
            ? 'Release the motors before physically moving the laser head.'
            : 'Controller has no sleep command.'
        }
      >
        {props.releasing ? 'Releasing motors...' : 'Release motors to move by hand'}
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
