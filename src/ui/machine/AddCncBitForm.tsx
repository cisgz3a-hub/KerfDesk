import { useState } from 'react';
import { MAX_CNC_TIP_ANGLE_DEG, MIN_CNC_TIP_ANGLE_DEG } from '../../core/cnc-tip-angle';
import { DEFAULT_ASSUMED_FLUTE_COUNT } from '../../core/cnc/machine-starters';
import type { CncTool, CncToolKind } from '../../core/scene';
import { useStore } from '../state';
import { CncToolPicture } from './CncToolPicture';
import {
  MAX_TAPER_SIDE_ANGLE_DEG,
  MAX_TOOL_DIAMETER_MM,
  MIN_TAPER_SIDE_ANGLE_DEG,
  MIN_TOOL_DIAMETER_MM,
  bitFormError,
  bitFormGeometry,
  bitFromForm,
  taperedBallFormHint,
  type BitFormGeometry,
} from './add-cnc-bit-form-model';

const TOOL_KIND_OPTIONS: ReadonlyArray<{ readonly value: CncToolKind; readonly label: string }> = [
  { value: 'end-mill', label: 'End mill' },
  { value: 'ball-nose', label: 'Ball nose' },
  { value: 'v-bit', label: 'V-bit' },
  { value: 'engraving', label: 'Engraving' },
  { value: 'tapered-ball-nose', label: 'Tapered ball nose' },
];

// The diameter is the cutting diameter, never the shank: V-carve depth is
// limited by it, so a shank size on a fine engraving bit carves far too deep.
const CONE_DIAMETER_TITLE =
  'Widest cutting diameter of the cone in millimeters, not the shank. V-carve depth is limited by this width, so a fine engraving bit on a 1/8-inch shank needs its small cone diameter here.';
const CUTTER_DIAMETER_TITLE =
  "Enter the cutter's actual cutting diameter in millimeters, not the shank.";

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
  const [pictureRequested, setPictureRequested] = useState(false);
  const input = { name, kind, diameter, flutes, tipAngle, tipDiameter };
  const geometry = bitFormGeometry(kind);
  const error = bitFormError(input);

  const handleAdd = (): void => {
    setHasSubmitted(true);
    if (error !== null) return;
    (props.onAdd ?? addCustomCncTool)(bitFromForm(input));
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
        onNameChange={setName}
        onKindChange={(value) => {
          setKind(value);
          setPictureRequested(true);
          setHasSubmitted(false);
        }}
        onDiameterChange={setDiameter}
        onFlutesChange={setFlutes}
      />
      <GeometryFields
        geometry={geometry}
        diameter={diameter}
        tipAngle={tipAngle}
        tipDiameter={tipDiameter}
        onTipAngleChange={setTipAngle}
        onTipDiameterChange={setTipDiameter}
      />
      <button type="button" onClick={handleAdd} aria-label="Add bit" title="Add the custom bit.">
        Add
      </button>
      <CncToolPicture
        key={kind}
        tool={{ kind, tipDiameterMm: Number(tipDiameter) }}
        initiallyOpen={pictureRequested}
        label="New bit shape"
      />
      <BitHint message={taperedBallFormHint(input)} />
      <BitError message={hasSubmitted ? error : null} />
    </div>
  );
}

function BitError(props: { readonly message: string | null }): JSX.Element | null {
  return props.message === null ? null : (
    <span role="alert" style={errorStyle}>
      {props.message}
    </span>
  );
}

function BitHint(props: { readonly message: string | null }): JSX.Element | null {
  return props.message === null ? null : (
    <span role="status" style={hintStyle}>
      {props.message}
    </span>
  );
}

type BitFieldsProps = {
  readonly name: string;
  readonly kind: CncToolKind;
  readonly diameter: string;
  readonly flutes: string;
  readonly onNameChange: (value: string) => void;
  readonly onKindChange: (value: CncToolKind) => void;
  readonly onDiameterChange: (value: string) => void;
  readonly onFlutesChange: (value: string) => void;
};

function BitFields(props: BitFieldsProps): JSX.Element {
  // A tapered bit's stored diameter is where its flutes END, not its tip; the
  // field says so because sellers often call the tip the cutting diameter.
  const tapered = props.kind === 'tapered-ball-nose';
  const cutDiameterTitle =
    props.kind === 'v-bit' || props.kind === 'engraving'
      ? CONE_DIAMETER_TITLE
      : CUTTER_DIAMETER_TITLE;
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
        title="Bit geometry: end mill, ball nose, v-bit, engraving, or tapered ball nose."
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
        placeholder={tapered ? 'Top dia mm' : 'Cutting Ø mm'}
        aria-label={
          tapered ? 'New bit cut diameter at the top of the flutes (mm)' : 'New bit diameter (mm)'
        }
        title={
          tapered
            ? 'Diameter where the tapered flutes end. For most carving bits this equals the shank diameter; it is not the tip size.'
            : cutDiameterTitle
        }
        style={numberInputStyle}
      />
      <input
        type="number"
        value={props.flutes}
        onChange={(event) => props.onFlutesChange(event.target.value)}
        min={1}
        step={1}
        placeholder="Flutes"
        aria-label="New bit flute count"
        title="Enter the cutter's actual number of cutting flutes."
        style={numberInputStyle}
      />
    </>
  );
}

type GeometryFieldsProps = {
  readonly geometry: BitFormGeometry;
  readonly diameter: string;
  readonly tipAngle: string;
  readonly tipDiameter: string;
  readonly onTipAngleChange: (value: string) => void;
  readonly onTipDiameterChange: (value: string) => void;
};

function GeometryFields(props: GeometryFieldsProps): JSX.Element {
  return (
    <>
      {props.geometry.needsAngle ? (
        props.geometry.anglePerSide ? (
          <input
            type="number"
            value={props.tipAngle}
            onChange={(event) => props.onTipAngleChange(event.target.value)}
            min={MIN_TAPER_SIDE_ANGLE_DEG}
            max={MAX_TAPER_SIDE_ANGLE_DEG}
            step={0.01}
            placeholder="Deg/side"
            aria-label="New bit taper angle per side (deg)"
            title="Taper angle per side as sellers list it, for example 5.4. KerfDesk stores the included angle, twice this value."
            style={numberInputStyle}
          />
        ) : (
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
        )
      ) : null}
      {props.geometry.needsTipDiameter ? (
        <TipDiameterField
          required={props.geometry.tipRequired}
          diameter={props.diameter}
          value={props.tipDiameter}
          onChange={props.onTipDiameterChange}
        />
      ) : null}
    </>
  );
}

function TipDiameterField(props: {
  readonly required: boolean;
  readonly diameter: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  // Engraving: an optional flat land at the tip. Tapered ball nose: the
  // required ball that the taper blends into.
  return (
    <input
      type="number"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      min={0}
      max={props.diameter === '' ? undefined : Number(props.diameter)}
      step={props.required ? 0.01 : 0.05}
      placeholder={props.required ? 'Tip dia mm' : 'Tip flat mm'}
      aria-label={
        props.required ? 'New bit ball tip diameter (mm)' : 'New bit tip flat diameter (mm)'
      }
      title={
        props.required
          ? 'Diameter of the rounded tip: twice the listed tip radius. Some sellers call it the cutting diameter.'
          : 'Width of the flat land at the very tip. Leave blank for a bit that comes to a point.'
      }
      style={numberInputStyle}
    />
  );
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
const hintStyle: React.CSSProperties = {
  flexBasis: '100%',
  color: 'var(--lf-text-muted)',
  fontSize: 11,
};
const errorStyle: React.CSSProperties = {
  flexBasis: '100%',
  color: 'var(--lf-danger-fg)',
  fontSize: 11,
};
