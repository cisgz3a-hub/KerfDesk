// Viewer3DToolbar — display mode, section plane and PNG export controls.
//
// Presentational only: it owns no state and touches no three object. The page
// above it holds the mode and the section position, which is what makes this
// testable in jsdom while the scene it drives is not.

import { DISPLAY_MODE_CHOICES, type Viewer3DDisplayMode } from './viewer3d-display-mode';

const SECTION_STEP = 0.01;

export function Viewer3DToolbar(props: {
  readonly mode: Viewer3DDisplayMode;
  readonly onModeChange: (mode: Viewer3DDisplayMode) => void;
  readonly sectionFraction: number;
  readonly onSectionChange: (fraction: number) => void;
  readonly onSavePng: () => void;
}): JSX.Element {
  const { mode, onModeChange, sectionFraction, onSectionChange, onSavePng } = props;
  return (
    <div style={barStyle}>
      <div role="group" aria-label="Display mode" style={groupStyle}>
        {DISPLAY_MODE_CHOICES.map((choice) => (
          <button
            key={choice.mode.kind}
            type="button"
            aria-pressed={choice.mode.kind === mode.kind}
            onClick={() => onModeChange(choice.mode)}
            title={choice.hint}
            style={choice.mode.kind === mode.kind ? activeButtonStyle : buttonStyle}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <label style={sliderLabelStyle}>
        Section
        <input
          type="range"
          min={0}
          max={1}
          step={SECTION_STEP}
          value={sectionFraction}
          aria-label="Section plane position"
          onChange={(event) => onSectionChange(Number(event.target.value))}
          title="Slice the part open from the front to inspect pocket floors and wall angles."
          style={sliderStyle}
        />
      </label>
      <button
        type="button"
        onClick={onSavePng}
        style={buttonStyle}
        title="Save the current 3D view as a PNG image."
      >
        Save PNG
      </button>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};
const groupStyle: React.CSSProperties = { display: 'flex', gap: 4 };
const buttonStyle: React.CSSProperties = {
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 11,
};
const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  fontWeight: 700,
  // Bold alone is a weak affordance on a row of four; the outline is what makes
  // the current mode readable at a glance.
  outline: '1px solid currentColor',
};
const sliderLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
};
const sliderStyle: React.CSSProperties = { width: 120 };
