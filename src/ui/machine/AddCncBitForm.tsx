import { useState } from 'react';
import {
  MAX_CNC_TIP_ANGLE_DEG,
  MIN_CNC_TIP_ANGLE_DEG,
  isValidCncTipAngleDeg,
} from '../../core/cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../../core/cnc-tip-diameter';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters';
import type { CncTool, CncToolKind } from '../../core/scene';
import { useStore } from '../state';

const TOOL_KIND_OPTIONS: ReadonlyArray<{ readonly value: CncToolKind; readonly label: string }> = [
  { value: 'end-mill', label: 'End mill' },
  { value: 'ball-nose', label: 'Ball nose' },
  { value: 'v-bit', label: 'V-bit' },
  { value: 'engraving', label: 'Engraving' },
];

const MAX_TOOL_DIAMETER_MM = 50;
const MIN_TOOL_DIAMETER_MM = 0.1;
const MAX_TOOL_FLUTES = 16;

export function AddCncBitForm(
  props: {
    readonly onAdd?: (tool: Omit<CncTool, 'id'>) => void;
  } = {},
): JSX.Element {
  const addCustomCncTool = useStore((state) => state.addCustomCncTool);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CncToolKind>('end-mill');
  const [diameter, setDiameter] = useState('');
  const [flutes, setFlutes] = useState(String(DEFAULT_ASSUMED_FLUTE_COUNT));
  const [tipAngle, setTipAngle] = useState('');
  const [tipDiameter, setTipDiameter] = useState('');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const needsAngle = kind === 'v-bit' || kind === 'engraving';
  // Only an engraving bit has a flat land at the tip; a v-bit comes to a point
  // by definition, which is the physical difference between the two kinds.
  const needsTipDiameter = kind === 'engraving';
  const error = bitFormError({ name, diameter, flutes, tipAngle, tipDiameter, needsAngle });

  const handleAdd = (): void => {
    setHasSubmitted(true);
    if (error !== null) return;
    (props.onAdd ?? addCustomCncTool)({
      name: name.trim(),
      kind,
      diameterMm: Number(diameter),
      fluteCount: Number(flutes),
      ...(needsAngle ? { tipAngleDeg: Number(tipAngle) } : {}),
      // Blank stays absent: the simulator reads that as a true point, matching
      // how every tool behaved before the field existed.
      ...(needsTipDiameter && tipDiameter.trim() !== ''
        ? { tipDiameterMm: Number(tipDiameter) }
        : {}),
    });
    setName('');
    setDiameter('');
    setFlutes(String(DEFAULT_ASSUMED_FLUTE_COUNT));
    setTipAngle('');
    setTipDiameter('');
    setHasSubmitted(false);
  };

  return (
    <div style={addFormStyle}>
      <BitFields
        name={name}
        kind={kind}
        diameter={diameter}
        flutes={flutes}
        tipAngle={tipAngle}
        tipDiameter={tipDiameter}
        needsAngle={needsAngle}
        needsTipDiameter={needsTipDiameter}
        onNameChange={setName}
        onKindChange={(value) => {
          setKind(value);
          setHasSubmitted(false);
        }}
        onDiameterChange={setDiameter}
        onFlutesChange={setFlutes}
        onTipAngleChange={setTipAngle}
        onTipDiameterChange={setTipDiameter}
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
  readonly flutes: string;
  readonly tipAngle: string;
  readonly tipDiameter: string;
  readonly needsAngle: boolean;
  readonly needsTipDiameter: boolean;
  readonly onNameChange: (value: string) => void;
  readonly onKindChange: (value: CncToolKind) => void;
  readonly onDiameterChange: (value: string) => void;
  readonly onFlutesChange: (value: string) => void;
  readonly onTipAngleChange: (value: string) => void;
  readonly onTipDiameterChange: (value: string) => void;
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
      <input
        type="number"
        value={props.flutes}
        onChange={(event) => props.onFlutesChange(event.target.value)}
        min={1}
        max={MAX_TOOL_FLUTES}
        step={1}
        placeholder="Flutes"
        aria-label="New bit flute count"
        title="Enter the cutter's actual number of cutting flutes."
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
      {props.needsTipDiameter ? (
        <input
          type="number"
          value={props.tipDiameter}
          onChange={(event) => props.onTipDiameterChange(event.target.value)}
          min={0}
          max={props.diameter === '' ? undefined : Number(props.diameter)}
          step={0.05}
          placeholder="Tip flat mm"
          aria-label="New bit tip flat diameter (mm)"
          title="Width of the flat land at the very tip. Leave blank for a bit that comes to a point."
          style={numberInputStyle}
        />
      ) : null}
    </>
  );
}

function bitFormError(input: {
  readonly name: string;
  readonly diameter: string;
  readonly flutes: string;
  readonly tipAngle: string;
  readonly tipDiameter: string;
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
  const fluteCount = Number(input.flutes);
  if (isInvalidFluteCount(input.flutes, fluteCount)) {
    return `Enter the actual flute count from 1 to ${MAX_TOOL_FLUTES}.`;
  }
  const tipAngleDeg = Number(input.tipAngle);
  if (input.needsAngle && (input.tipAngle.trim() === '' || !isValidCncTipAngleDeg(tipAngleDeg))) {
    return `Enter the actual included angle from ${MIN_CNC_TIP_ANGLE_DEG} to ${MAX_CNC_TIP_ANGLE_DEG} degrees.`;
  }
  return tipDiameterError(input.tipDiameter, diameterMm);
}

function isInvalidFluteCount(rawValue: string, fluteCount: number): boolean {
  return (
    rawValue.trim() === '' ||
    !Number.isInteger(fluteCount) ||
    fluteCount < 1 ||
    fluteCount > MAX_TOOL_FLUTES
  );
}

// Blank is valid — it means the bit comes to a point. A land at or past the
// cutter diameter is not a cone at all, so the cone law would have no flank.
function tipDiameterError(tipDiameter: string, diameterMm: number): string | null {
  if (tipDiameter.trim() === '') return null;
  const tipDiameterMm = Number(tipDiameter);
  if (!isValidCncTipDiameterMm(tipDiameterMm, diameterMm)) {
    return `Enter a tip flat from 0 to under the ${diameterMm} mm cutter diameter, or leave it blank for a pointed bit.`;
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
