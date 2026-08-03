// WoodViewControls — the reference page's control strip: WOOD, GROOVE, VIEW and
// LIGHT (ADR-285). Ported verbatim in behaviour and grouping.

import { CAMERA_PRESETS, GROOVE_FILLS, WOOD_SPECIES } from './wood-view-palettes';

export type WoodViewControlsProps = {
  readonly species: string;
  readonly fill: string;
  readonly view: string;
  readonly lightAzimuthDeg: number;
  readonly onSpecies: (name: string) => void;
  readonly onFill: (name: string) => void;
  readonly onView: (name: string) => void;
  readonly onLight: (degrees: number) => void;
};

const LIGHT_MIN_DEG = 0;
const LIGHT_MAX_DEG = 360;

function Group(props: {
  readonly label: string;
  readonly names: ReadonlyArray<string>;
  readonly active: string;
  readonly titleFor: (name: string) => string;
  readonly onPick: (name: string) => void;
}): JSX.Element {
  return (
    <div style={groupStyle}>
      <span style={labelStyle}>{props.label}</span>
      <div style={rowStyle}>
        {props.names.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === props.active}
            title={props.titleFor(name)}
            onClick={() => props.onPick(name)}
            style={name === props.active ? activeChipStyle : chipStyle}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WoodViewControls(props: WoodViewControlsProps): JSX.Element {
  return (
    <div style={barStyle}>
      <Group
        label="Wood"
        names={Object.keys(WOOD_SPECIES)}
        active={props.species}
        titleFor={(name) => `Preview the carve in ${name}.`}
        onPick={props.onSpecies}
      />
      <Group
        label="Groove"
        names={Object.keys(GROOVE_FILLS)}
        active={props.fill}
        titleFor={(name) => `Show the groove finished as: ${name}.`}
        onPick={props.onFill}
      />
      <Group
        label="View"
        names={Object.keys(CAMERA_PRESETS)}
        active={props.view}
        titleFor={(name) => `Move the camera to the ${name} view.`}
        onPick={props.onView}
      />
      <div style={groupStyle}>
        <span style={labelStyle}>Light</span>
        <input
          type="range"
          aria-label="Light direction"
          title="Swing the key light around the board."
          min={LIGHT_MIN_DEG}
          max={LIGHT_MAX_DEG}
          value={props.lightAzimuthDeg}
          onChange={(event) => props.onLight(Number(event.target.value))}
          style={sliderStyle}
        />
      </div>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px 18px',
  alignItems: 'center',
  padding: '8px 10px',
};
const groupStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--lf-text-muted)',
};
const rowStyle: React.CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const chipStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 11,
  padding: '4px 10px',
  borderRadius: 999,
  cursor: 'pointer',
  border: '1px solid var(--lf-border)',
  background: 'transparent',
  color: 'inherit',
};
const activeChipStyle: React.CSSProperties = {
  ...chipStyle,
  background: 'var(--lf-accent)',
  borderColor: 'var(--lf-accent)',
  color: 'var(--lf-accent-fg)',
  fontWeight: 600,
};
const sliderStyle: React.CSSProperties = { width: 120, accentColor: 'var(--lf-accent)' };
