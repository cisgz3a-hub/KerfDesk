import { useState } from 'react';
import { findRegistrationBoxes, type ShapeObject } from '../../core/scene';
import { Button, NumberInput } from '../kit';
import { useStore } from '../state';

const DEFAULT_WIDTH_MM = 80;
const DEFAULT_HEIGHT_MM = 40;
const DEFAULT_DIAMETER_MM = 60;

type RegistrationJigShape = 'rectangle' | 'circle';
type InitialOutlineControls = {
  readonly hasOutline: boolean;
  readonly locked: boolean;
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
};

export function RegistrationJigOutlineControls(): JSX.Element {
  const scene = useStore((s) => s.project.scene);
  const addRegistrationBox = useStore((s) => s.addRegistrationBox);
  const addRegistrationCircle = useStore((s) => s.addRegistrationCircle);
  const removeBox = useStore((s) => s.removeRegistrationBox);
  const setBoxLocked = useStore((s) => s.setRegistrationBoxLocked);

  const initial = initialOutlineControls(findRegistrationBoxes(scene)[0]);
  const [shape, setShape] = useState<RegistrationJigShape>(initial.shape);
  const [widthMm, setWidthMm] = useState(initial.widthMm);
  const [heightMm, setHeightMm] = useState(initial.heightMm);
  const [diameterMm, setDiameterMm] = useState(initial.diameterMm);

  return (
    <>
      <div style={sizeRowStyle}>
        <ShapeSelect value={shape} onChange={setShape} />
        <ShapeSizeFields
          shape={shape}
          widthMm={widthMm}
          heightMm={heightMm}
          diameterMm={diameterMm}
          onWidthChange={setWidthMm}
          onHeightChange={setHeightMm}
          onDiameterChange={setDiameterMm}
        />
        <span style={unitStyle}>mm</span>
        <Button
          variant="primary"
          onClick={() =>
            createOutlineFromState({
              shape,
              widthMm,
              heightMm,
              diameterMm,
              addRegistrationBox,
              addRegistrationCircle,
            })
          }
        >
          {buttonLabel(shape, initial.hasOutline)}
        </Button>
        <RemoveOutlineButton show={initial.hasOutline} onClick={removeBox} />
      </div>
      <LockOutlineControl
        show={initial.hasOutline}
        checked={initial.locked}
        onChange={setBoxLocked}
      />
    </>
  );
}

function initialOutlineControls(box: ShapeObject | undefined): InitialOutlineControls {
  if (box === undefined) return defaultOutlineControls();
  if (box.spec.kind === 'ellipse') {
    return {
      hasOutline: true,
      locked: box.locked === true,
      shape: 'circle',
      widthMm: String(DEFAULT_WIDTH_MM),
      heightMm: String(DEFAULT_HEIGHT_MM),
      diameterMm: String(box.spec.widthMm),
    };
  }
  if (box.spec.kind === 'rect') {
    return {
      hasOutline: true,
      locked: box.locked === true,
      shape: 'rectangle',
      widthMm: String(box.spec.widthMm),
      heightMm: String(box.spec.heightMm),
      diameterMm: String(DEFAULT_DIAMETER_MM),
    };
  }
  return { ...defaultOutlineControls(), hasOutline: true, locked: box.locked === true };
}

function defaultOutlineControls(): InitialOutlineControls {
  return {
    hasOutline: false,
    locked: false,
    shape: 'rectangle',
    widthMm: String(DEFAULT_WIDTH_MM),
    heightMm: String(DEFAULT_HEIGHT_MM),
    diameterMm: String(DEFAULT_DIAMETER_MM),
  };
}

function ShapeSelect(props: {
  readonly value: RegistrationJigShape;
  readonly onChange: (shape: RegistrationJigShape) => void;
}): JSX.Element {
  return (
    <select
      aria-label="Registration jig shape"
      value={props.value}
      style={shapeSelectStyle}
      onChange={(event) => props.onChange(parseJigShape(event.target.value))}
    >
      <option value="rectangle">Rectangle</option>
      <option value="circle">Circle</option>
    </select>
  );
}

function ShapeSizeFields(props: {
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
  readonly onWidthChange: (value: string) => void;
  readonly onHeightChange: (value: string) => void;
  readonly onDiameterChange: (value: string) => void;
}): JSX.Element {
  if (props.shape === 'circle') {
    return (
      <>
        <span>D</span>
        <NumberInput
          value={props.diameterMm}
          min={1}
          step={1}
          aria-label="Registration circle diameter"
          style={sizeInputStyle}
          onChange={(e) => props.onDiameterChange(e.target.value)}
        />
      </>
    );
  }
  return (
    <>
      <span>W</span>
      <NumberInput
        value={props.widthMm}
        min={1}
        step={1}
        aria-label="Registration box width"
        style={sizeInputStyle}
        onChange={(e) => props.onWidthChange(e.target.value)}
      />
      <span>H</span>
      <NumberInput
        value={props.heightMm}
        min={1}
        step={1}
        aria-label="Registration box height"
        style={sizeInputStyle}
        onChange={(e) => props.onHeightChange(e.target.value)}
      />
    </>
  );
}

function LockOutlineControl(props: {
  readonly show: boolean;
  readonly checked: boolean;
  readonly onChange: (locked: boolean) => void;
}): JSX.Element | null {
  if (!props.show) return null;
  return (
    <label style={lockRowStyle}>
      <input
        type="checkbox"
        checked={props.checked}
        aria-label="Lock registration outline"
        title="Lock the outline so it can't move between the two burns"
        onChange={(e) => props.onChange(e.target.checked)}
      />
      Lock outline (prevent moving between burns)
    </label>
  );
}

function RemoveOutlineButton(props: {
  readonly show: boolean;
  readonly onClick: () => void;
}): JSX.Element | null {
  if (!props.show) return null;
  return (
    <Button variant="danger" onClick={props.onClick}>
      Remove outline
    </Button>
  );
}

function createOutlineFromState(args: {
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
  readonly addRegistrationBox: (widthMm: number, heightMm: number) => void;
  readonly addRegistrationCircle: (diameterMm: number) => void;
}): void {
  if (args.shape === 'circle') {
    addCircleIfValid(args.diameterMm, args.addRegistrationCircle);
    return;
  }
  addBoxIfValid(args.widthMm, args.heightMm, args.addRegistrationBox);
}

function addCircleIfValid(diameterMm: string, addCircle: (diameterMm: number) => void): void {
  const d = Number(diameterMm);
  if (Number.isFinite(d) && d >= 1) addCircle(d);
}

function addBoxIfValid(
  widthMm: string,
  heightMm: string,
  addBox: (widthMm: number, heightMm: number) => void,
): void {
  const w = Number(widthMm);
  const h = Number(heightMm);
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1) addBox(w, h);
}

function parseJigShape(value: string): RegistrationJigShape {
  return value === 'circle' ? 'circle' : 'rectangle';
}

function buttonLabel(shape: RegistrationJigShape, hasBox: boolean): string {
  if (shape === 'circle') return hasBox ? 'Replace circle' : 'Create circle';
  return hasBox ? 'Replace box' : 'Create box';
}

const sizeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const shapeSelectStyle: React.CSSProperties = { width: 92 };
const sizeInputStyle: React.CSSProperties = { width: 56 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const lockRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
