// DesignViewportToolbar — the design space's own controls (ADR-272
// Amendment 2 clause 5): camera presets and the two carve tiers. Floats
// top-left inside the viewport, Blender's header idiom. Purely
// presentational — the viewport owns which content reaches the scene, so
// there is exactly one writer. Display-only per ADR-261 §3.

export function DesignViewportToolbar(props: {
  readonly tier: 'design' | 'bits';
  readonly canShowBits: boolean;
  readonly isStale: boolean;
  readonly failReason: string | null;
  readonly onPreset: (preset: 'top' | 'iso') => void;
  readonly onTier: (tier: 'design' | 'bits') => void;
  readonly onSimulate: () => void;
}): JSX.Element {
  return (
    <div style={barStyle}>
      <ToolButton
        label="Top"
        title="Look straight down at the stock — the precision drawing view"
        onClick={() => props.onPreset('top')}
      />
      <ToolButton
        label="Iso"
        title="Three-quarter view of the carve"
        onClick={() => props.onPreset('iso')}
      />
      <span style={dividerStyle} role="presentation" />
      <ToolButton
        label="Design"
        title="The target surface each layer asks for — instant, updates as you draw"
        active={props.tier === 'design'}
        onClick={() => props.onTier('design')}
      />
      <ToolButton
        label={props.isStale ? 'Bits (stale)' : 'Bits'}
        title={
          props.canShowBits
            ? props.isStale
              ? 'Simulated with each layer’s real bit — the drawing changed since this ran, press Simulate again'
              : 'Simulated from real toolpaths, each tool section stamped with its own bit'
            : 'Press Simulate first — compiles the layers and carves them with each bit’s real shape'
        }
        active={props.tier === 'bits'}
        disabled={!props.canShowBits}
        onClick={() => props.onTier('bits')}
      />
      <ToolButton
        label="Simulate"
        title="Compile the layers into real toolpaths and carve them with each layer's bit shape"
        onClick={props.onSimulate}
      />
      {props.failReason === null ? null : (
        <span style={reasonStyle} title={props.failReason}>
          {props.failReason}
        </span>
      )}
    </div>
  );
}

function ToolButton(props: {
  readonly label: string;
  readonly title: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      disabled={props.disabled === true}
      aria-pressed={props.active === true}
      style={{
        ...buttonStyle,
        ...(props.active === true ? activeStyle : null),
        ...(props.disabled === true ? disabledStyle : null),
      }}
    >
      {props.label}
    </button>
  );
}

const barStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-1)',
  zIndex: 2,
  maxWidth: 'calc(100% - 16px)',
};

// Non-shorthand border so the active variant's borderColor never conflicts
// (React warns when a shorthand and its longhand mix across rerenders).
const buttonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 9px',
  borderRadius: 5,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  background: 'transparent',
  color: 'var(--lf-text)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const activeStyle: React.CSSProperties = {
  borderColor: 'var(--lf-accent)',
  background: 'var(--lf-bg-input)',
};

// Inert until a simulation exists — a no-op control, not a gate (rule 7).
const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'default' };

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'var(--lf-border)',
  margin: '0 2px',
};

const reasonStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-dim)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 260,
};
