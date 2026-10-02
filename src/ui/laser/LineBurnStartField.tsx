import { isLineStartRegion, type LineStartRegion } from '../../core/scene/project';

const REGION_LABELS: ReadonlyArray<readonly [LineStartRegion, string]> = [
  ['back-left', 'Back left'],
  ['back-center', 'Back center'],
  ['back-right', 'Back right'],
  ['center-left', 'Left side'],
  ['center', 'Center'],
  ['center-right', 'Right side'],
  ['front-left', 'Front left'],
  ['front-center', 'Front center'],
  ['front-right', 'Front right'],
];

export function LineBurnStartField(props: {
  readonly value: LineStartRegion | undefined;
  readonly disabled?: boolean;
  readonly onChange: (value: LineStartRegion | undefined) => void;
}): JSX.Element {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>
        <span>Line burn start near</span>
        <select
          name="lineStartRegion"
          aria-label="Line burn start near"
          className="lf-select"
          style={selectStyle}
          value={props.value ?? ''}
          disabled={props.disabled === true}
          title="Choose a physical region of the artwork. This orders Line paths and chooses nearby existing closed-shape starts, even with Keep source order or Where drawn. Layer priority, Inside paths first, and Nearest corner still apply."
          onChange={(event) => {
            const value = event.currentTarget.value;
            props.onChange(isLineStartRegion(value) ? value : undefined);
          }}
        >
          <option value="">Use existing planner</option>
          {REGION_LABELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p style={scopeStyle}>
        Line contours only, at a nearby eligible path entry. Fill/raster keep their scan order; Job
        origin is unchanged.
      </p>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const selectStyle: React.CSSProperties = { flex: 1, minWidth: 120 };
const scopeStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--lf-text-muted)',
};
