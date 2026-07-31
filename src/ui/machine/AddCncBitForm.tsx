import { useState } from 'react';
import {
  MAX_CNC_TIP_ANGLE_DEG,
  MIN_CNC_TIP_ANGLE_DEG,
  isValidCncTipAngleDeg,
  type CncToolKind,
} from '../../core/scene';
import { useStore } from '../state';

const TOOL_KIND_OPTIONS: ReadonlyArray<{ readonly value: CncToolKind; readonly label: string }> = [
  { value: 'end-mill', label: 'End mill' },
  { value: 'ball-nose', label: 'Ball nose' },
  { value: 'v-bit', label: 'V-bit' },
  { value: 'engraving', label: 'Engraving' },
];

const MAX_TOOL_DIAMETER_MM = 50;
const MIN_TOOL_DIAMETER_MM = 0.1;

export function AddCncBitForm(): JSX.Element {
  const addCustomCncTool = useStore((state) => state.addCustomCncTool);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CncToolKind>('end-mill');
  const [diameter, setDiameter] = useState('');
  const [tipAngle, setTipAngle] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const needsAngle = kind === 'v-bit' || kind === 'engraving';
  const error = bitFormError({ name, diameter, tipAngle, needsAngle });

  const handleAdd = (): void => {
    setHasSubmitted(true);
    if (error !== null) return;
    addCustomCncTool({
      name: name.trim(),
      kind,
      diameterMm: Number(diameter),
      ...(needsAngle ? { tipAngleDeg: Number(tipAngle) } : {}),
    });
    setName('');
    setDiameter('');
    setTipAngle('');
    setHasSubmitted(false);
  };

  return (
    <div style={addFormStyle}>
      <BitFields
        name={name}
        kind={kind}
        diameter={diameter}
        tipAngle={tipAngle}
        needsAngle={needsAngle}
        onNameChange={setName}
        onKindChange={(value) => {
          setKind(value);
          setHasSubmitted(false);
        }}
        onDiameterChange={setDiameter}
        onTipAngleChange={setTipAngle}
      />
      <button type="button" onClick={handleAdd} aria-label="Add bit" title="Add the custom bit.">
        Add
      </button>
      {hasSubmitted && error !== null ? (
        <span role="alert" style={errorStyle}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

type BitFieldsProps = {
  readonly name: string;
  readonly kind: CncToolKind;
  readonly diameter: string;
  readonly tipAngle: string;
  readonly needsAngle: boolean;
  readonly onNameChange: (value: string) => void;
  readonly onKindChange: (value: CncToolKind) => void;
  readonly onDiameterChange: (value: string) => void;
  readonly onTipAngleChange: (value: string) => void;
};

function BitFields(props: BitFieldsProps): JSX.Element {
  return (
    <>
      <input
        type="text"
        value={props.name}
        onChange={(event) => props.onNameChange(event.target.value)}
        placeholder="Bit name"
        aria-label="New bit name"
        title="Display name for the custom bit."
        style={nameInputStyle}
      />
      <select
        value={props.kind}
        onChange={(event) => props.onKindChange(event.target.value as CncToolKind)}
        aria-label="New bit kind"
        title="Bit geometry: end mill, ball nose, v-bit, or engraving."
        style={kindSelectStyle}
      >
        {TOOL_KIND_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={props.diameter}
        onChange={(event) => props.onDiameterChange(event.target.value)}
        min={MIN_TOOL_DIAMETER_MM}
        max={MAX_TOOL_DIAMETER_MM}
        step={0.1}
        placeholder="Diameter mm"
        aria-label="New bit diameter (mm)"
        title="Enter the cutter's actual diameter in millimeters."
        style={numberInputStyle}
      />
      {props.needsAngle ? (
        <input
          type="number"
          value={props.tipAngle}
          onChange={(event) => props.onTipAngleChange(event.target.value)}
          min={MIN_CNC_TIP_ANGLE_DEG}
          max={MAX_CNC_TIP_ANGLE_DEG}
          step={1}
          placeholder="Angle deg"
          aria-label="New bit included angle (deg)"
          title="Enter the cutter's actual included angle."
          style={numberInputStyle}
        />
      ) : null}
    </>
  );
}

function bitFormError(input: {
  readonly name: string;
  readonly diameter: string;
  readonly tipAngle: string;
  readonly needsAngle: boolean;
}): string | null {
  if (input.name.trim() === '') return 'Enter a bit name.';
  const diameterMm = Number(input.diameter);
  if (
    input.diameter.trim() === '' ||
    !Number.isFinite(diameterMm) ||
    diameterMm < MIN_TOOL_DIAMETER_MM ||
    diameterMm > MAX_TOOL_DIAMETER_MM
  ) {
    return `Enter the actual cutter diameter from ${MIN_TOOL_DIAMETER_MM} to ${MAX_TOOL_DIAMETER_MM} mm.`;
  }
  const tipAngleDeg = Number(input.tipAngle);
  if (input.needsAngle && (input.tipAngle.trim() === '' || !isValidCncTipAngleDeg(tipAngleDeg))) {
    return `Enter the actual included angle from ${MIN_CNC_TIP_ANGLE_DEG} to ${MAX_CNC_TIP_ANGLE_DEG} degrees.`;
  }
  return null;
}

const addFormStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 6,
  flexWrap: 'wrap',
};
const nameInputStyle: React.CSSProperties = { flex: 1, minWidth: 90, padding: '2px 6px' };
const kindSelectStyle: React.CSSProperties = { fontSize: 12, padding: '2px 4px' };
const numberInputStyle: React.CSSProperties = { width: 76, padding: '2px 6px' };
const errorStyle: React.CSSProperties = {
  flexBasis: '100%',
  color: 'var(--lf-danger)',
  fontSize: 11,
};
