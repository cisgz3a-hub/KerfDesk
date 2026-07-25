// CanvasViewSwitch — swaps the MAIN canvas between the design view and the
// G-code 3D view (ADR-255 stage 9b). Pinned to the canvas itself rather than
// buried in a menu, because switching between "what I drew" and "what the
// machine will run" is a thing operators do constantly.

const DESIGN_LABEL = 'Design';
const GCODE_LABEL = 'G-code 3D';

export function CanvasViewSwitch(props: {
  readonly showGcode: boolean;
  readonly onChange: (showGcode: boolean) => void;
}): JSX.Element {
  return (
    <div style={wrapStyle} role="group" aria-label="Canvas view">
      <Option
        label={DESIGN_LABEL}
        title="Show the design canvas"
        selected={!props.showGcode}
        onSelect={() => props.onChange(false)}
      />
      <Option
        label={GCODE_LABEL}
        title="Show this project's G-code in 3D — read-only, nothing is saved or sent"
        selected={props.showGcode}
        onSelect={() => props.onChange(true)}
      />
    </div>
  );
}

function Option(props: {
  readonly label: string;
  readonly title: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-btn"
      title={props.title}
      aria-pressed={props.selected}
      style={{
        ...optionStyle,
        background: props.selected ? 'var(--lf-accent-wash)' : 'transparent',
        fontWeight: props.selected ? 600 : 400,
      }}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  );
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  zIndex: 3,
  display: 'flex',
  gap: 2,
  padding: 2,
  borderRadius: 6,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
};

const optionStyle: React.CSSProperties = {
  padding: '2px 10px',
  fontSize: 'var(--lf-text-xs)',
  border: 'none',
};
