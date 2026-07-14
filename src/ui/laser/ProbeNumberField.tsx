import { NumberField as ClearableNumberField } from '../common/NumberField';

const PROBE_VALUE_MIN_MM = 0.1;
const PROBE_VALUE_MAX_MM = 100;

const NUMBER_FIELD_TITLES: Readonly<Record<string, string>> = {
  'Plate thickness': 'Distance from the plate top to its underside â€” sets where work Z0 lands.',
  'Max travel': 'How far a probe move may travel before failing with ALARM:5.',
  'Bit diameter': 'Used to offset the X and Y zeros by one bit radius at side contact.',
  'Plate center X offset': 'Measured starting cutter-center distance from the X stock face.',
  'Plate center Y offset': 'Measured starting cutter-center distance from the Y stock face.',
  'Side probe drop': 'How far below the plate top the cutter flank contacts each side.',
  'Side clearance': 'Outward travel before descending beside the plate.',
};

export function ProbeNumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      {props.label}
      <span style={unitWrapStyle}>
        <ClearableNumberField
          ariaLabel={props.label}
          title={NUMBER_FIELD_TITLES[props.label] ?? props.label}
          value={props.value}
          min={PROBE_VALUE_MIN_MM}
          max={PROBE_VALUE_MAX_MM}
          step={0.01}
          onCommit={props.onCommit}
          style={inputStyle}
        />
        mm
      </span>
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  flex: 1,
};
const unitWrapStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };
const inputStyle: React.CSSProperties = { width: 70 };
