import { Button, NumberInput } from '../kit';

export type RegistrationJigShape = 'rectangle' | 'circle';

export function RegistrationJigShapeFields(props: {
  readonly shape: RegistrationJigShape;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly diameterMm: string;
  readonly onShapeChange: (shape: RegistrationJigShape) => void;
  readonly onWidthChange: (value: string) => void;
  readonly onHeightChange: (value: string) => void;
  readonly onDiameterChange: (value: string) => void;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <select
        aria-label="Registration jig shape"
        title="Choose the physical outline to burn for aligning rectangular or round blanks."
        value={props.shape}
        style={shapeSelectStyle}
        onChange={(event) => props.onShapeChange(parseJigShape(event.target.value))}
      >
        <option value="rectangle">Rectangle</option>
        <option value="circle">Circle</option>
      </select>
      {props.shape === 'circle' ? (
        <CircleSizeField value={props.diameterMm} onChange={props.onDiameterChange} />
      ) : (
        <RectangleSizeFields
          widthMm={props.widthMm}
          heightMm={props.heightMm}
          onWidthChange={props.onWidthChange}
          onHeightChange={props.onHeightChange}
        />
      )}
      <span style={mutedStyle}>mm</span>
    </div>
  );
}

export function RegistrationJigGridFields(props: {
  readonly rows: string;
  readonly columns: string;
  readonly spacingX: string;
  readonly spacingY: string;
  readonly onRowsChange: (value: string) => void;
  readonly onColumnsChange: (value: string) => void;
  readonly onSpacingXChange: (value: string) => void;
  readonly onSpacingYChange: (value: string) => void;
}): JSX.Element {
  return (
    <div style={gridFieldsStyle}>
      <div style={rowStyle}>
        <span>Grid</span>
        <NumberInput
          aria-label="Jig rows"
          value={props.rows}
          min={1}
          step={1}
          style={gridInputStyle}
          onChange={(event) => props.onRowsChange(event.target.value)}
        />
        <span aria-hidden>×</span>
        <NumberInput
          aria-label="Jig columns"
          value={props.columns}
          min={1}
          step={1}
          style={gridInputStyle}
          onChange={(event) => props.onColumnsChange(event.target.value)}
        />
        <span style={mutedStyle}>rows × columns</span>
      </div>
      <div style={rowStyle}>
        <span>Gap</span>
        <span>X</span>
        <NumberInput
          aria-label="Horizontal jig spacing"
          value={props.spacingX}
          min={0}
          step={1}
          style={gridInputStyle}
          onChange={(event) => props.onSpacingXChange(event.target.value)}
        />
        <span>Y</span>
        <NumberInput
          aria-label="Vertical jig spacing"
          value={props.spacingY}
          min={0}
          step={1}
          style={gridInputStyle}
          onChange={(event) => props.onSpacingYChange(event.target.value)}
        />
        <span style={mutedStyle}>mm</span>
      </div>
    </div>
  );
}

export function LockRegistrationJigSetControl(props: {
  readonly show: boolean;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly outlineCount: number;
  readonly onChange: (locked: boolean) => void;
}): JSX.Element | null {
  if (!props.show) return null;
  return (
    <label style={lockRowStyle}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-label="Lock registration outlines"
        title={
          props.disabled
            ? 'A captured board stays locked — its position is the work origin'
            : 'Lock every outline so the jig set cannot move between the two burns'
        }
        onChange={(event) => props.onChange(event.target.checked)}
      />
      Lock {props.outlineCount === 1 ? 'outline' : 'all outlines'}
    </label>
  );
}

export function RemoveRegistrationJigSetButton(props: {
  readonly show: boolean;
  readonly outlineCount: number;
  readonly onClick: () => void;
}): JSX.Element | null {
  if (!props.show) return null;
  return (
    <Button variant="danger" onClick={props.onClick}>
      Remove {props.outlineCount === 1 ? 'outline' : 'all outlines'}
    </Button>
  );
}

function RectangleSizeFields(props: {
  readonly widthMm: string;
  readonly heightMm: string;
  readonly onWidthChange: (value: string) => void;
  readonly onHeightChange: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <span>W</span>
      <NumberInput
        value={props.widthMm}
        min={1}
        step={1}
        aria-label="Registration box width"
        style={sizeInputStyle}
        onChange={(event) => props.onWidthChange(event.target.value)}
      />
      <span>H</span>
      <NumberInput
        value={props.heightMm}
        min={1}
        step={1}
        aria-label="Registration box height"
        style={sizeInputStyle}
        onChange={(event) => props.onHeightChange(event.target.value)}
      />
    </>
  );
}

function CircleSizeField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <span>D</span>
      <NumberInput
        value={props.value}
        min={1}
        step={1}
        aria-label="Registration circle diameter"
        style={sizeInputStyle}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </>
  );
}

function parseJigShape(value: string): RegistrationJigShape {
  return value === 'circle' ? 'circle' : 'rectangle';
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const gridFieldsStyle: React.CSSProperties = { display: 'grid', gap: 6 };
const shapeSelectStyle: React.CSSProperties = { width: 92 };
const sizeInputStyle: React.CSSProperties = { width: 56 };
const gridInputStyle: React.CSSProperties = { width: 48 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontSize: 12 };
const lockRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
