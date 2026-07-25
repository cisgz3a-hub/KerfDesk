// CanvasViewSwitch — swaps the MAIN canvas between the design view and the
// G-code 3D PREVIEW (ADR-255 stage 9b). The preview is a glance at the
// program; the toolbar's "Inspect G-code (3D)" opens the in-depth screen.
//
// The selected side uses the design system's primary-button look (solid
// accent) rather than a tint: at canvas scale a pale wash reads as
// "disabled", not "current".

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
      className={props.selected ? 'lf-btn lf-btn--primary' : 'lf-btn'}
      title={props.title}
      aria-pressed={props.selected}
      style={{
        ...optionStyle,
        ...(props.selected ? {} : unselectedStyle),
        fontWeight: props.selected ? 600 : 500,
      }}
      onClick={props.onSelect}
    >
      {props.label}
    </button>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 2,
  borderRadius: 'var(--lf-radius-lg)',
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
};

const optionStyle: React.CSSProperties = {
  padding: '4px 14px',
  fontSize: 'var(--lf-text-md)',
  lineHeight: 1.4,
  borderRadius: 'var(--lf-radius-md)',
  whiteSpace: 'nowrap',
};

const unselectedStyle: React.CSSProperties = {
  background: 'transparent',
  borderColor: 'transparent',
};
