import { useState } from 'react';
import type { ArraySpec, Bounds } from '../../core/scene';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';

export function ArrayDialog(props: {
  readonly selectionBounds: Bounds;
  readonly onCancel: () => void;
  readonly onApply: (spec: ArraySpec) => void;
}): JSX.Element {
  const [mode, setMode] = useState<'grid' | 'circular'>('grid');
  const [rows, setRows] = useState('2');
  const [columns, setColumns] = useState('2');
  const [spacingX, setSpacingX] = useState('2');
  const [spacingY, setSpacingY] = useState('2');
  const [count, setCount] = useState('6');
  const [centerX, setCenterX] = useState(center(props.selectionBounds, 'x').toFixed(2));
  const [centerY, setCenterY] = useState(center(props.selectionBounds, 'y').toFixed(2));
  const [radius, setRadius] = useState('25');
  const [startAngle, setStartAngle] = useState('0');
  const [rotateCopies, setRotateCopies] = useState(false);
  const submit = (): void =>
    props.onApply(
      mode === 'grid'
        ? {
            kind: 'grid',
            rows: positiveInteger(rows),
            columns: positiveInteger(columns),
            spacingX: nonNegative(spacingX),
            spacingY: nonNegative(spacingY),
          }
        : {
            kind: 'circular',
            count: positiveInteger(count),
            centerX: finiteNumber(centerX),
            centerY: finiteNumber(centerY),
            radius: nonNegative(radius),
            startAngleDeg: finiteNumber(startAngle),
            rotateCopies,
          },
    );
  return (
    <Dialog
      title="Array"
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div role="tablist" aria-label="Array type" style={tabsStyle}>
        <ModeButton active={mode === 'grid'} label="Grid" onClick={() => setMode('grid')} />
        <ModeButton
          active={mode === 'circular'}
          label="Circular"
          onClick={() => setMode('circular')}
        />
      </div>
      {mode === 'grid' ? (
        <GridFields
          values={{ rows, columns, spacingX, spacingY }}
          setters={{ setRows, setColumns, setSpacingX, setSpacingY }}
        />
      ) : (
        <CircularFields
          values={{ count, centerX, centerY, radius, startAngle, rotateCopies }}
          setters={{ setCount, setCenterX, setCenterY, setRadius, setStartAngle, setRotateCopies }}
        />
      )}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Create array
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ModeButton(props: {
  readonly active: boolean;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      title={`Use ${props.label.toLowerCase()} array placement`}
      aria-selected={props.active}
      className="lf-button"
      style={{ ...tabStyle, fontWeight: props.active ? 600 : 400 }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

type Setter = (value: string) => void;

function GridFields(props: {
  readonly values: { rows: string; columns: string; spacingX: string; spacingY: string };
  readonly setters: {
    setRows: Setter;
    setColumns: Setter;
    setSpacingX: Setter;
    setSpacingY: Setter;
  };
}): JSX.Element {
  return (
    <div style={fieldsStyle}>
      <Field label="Rows" value={props.values.rows} min={1} step={1} set={props.setters.setRows} />
      <Field
        label="Columns"
        value={props.values.columns}
        min={1}
        step={1}
        set={props.setters.setColumns}
      />
      <Field
        label="Horizontal spacing (mm)"
        value={props.values.spacingX}
        min={0}
        set={props.setters.setSpacingX}
      />
      <Field
        label="Vertical spacing (mm)"
        value={props.values.spacingY}
        min={0}
        set={props.setters.setSpacingY}
      />
    </div>
  );
}

function CircularFields(props: {
  readonly values: {
    count: string;
    centerX: string;
    centerY: string;
    radius: string;
    startAngle: string;
    rotateCopies: boolean;
  };
  readonly setters: {
    setCount: Setter;
    setCenterX: Setter;
    setCenterY: Setter;
    setRadius: Setter;
    setStartAngle: Setter;
    setRotateCopies: (value: boolean) => void;
  };
}): JSX.Element {
  return (
    <div style={fieldsStyle}>
      <Field
        label="Copies"
        value={props.values.count}
        min={1}
        step={1}
        set={props.setters.setCount}
      />
      <Field label="Center X (mm)" value={props.values.centerX} set={props.setters.setCenterX} />
      <Field label="Center Y (mm)" value={props.values.centerY} set={props.setters.setCenterY} />
      <Field
        label="Radius (mm)"
        value={props.values.radius}
        min={0}
        set={props.setters.setRadius}
      />
      <Field
        label="Start angle (deg)"
        value={props.values.startAngle}
        set={props.setters.setStartAngle}
      />
      <label style={checkboxStyle}>
        <input
          type="checkbox"
          title="Rotate each copy to follow its position around the circle"
          checked={props.values.rotateCopies}
          onChange={(event) => props.setters.setRotateCopies(event.currentTarget.checked)}
        />
        Rotate copies around the circle
      </label>
    </div>
  );
}

function Field(props: {
  readonly label: string;
  readonly value: string;
  readonly min?: number;
  readonly step?: number;
  readonly set: Setter;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <NumberInput
        value={props.value}
        {...(props.min === undefined ? {} : { min: props.min })}
        step={props.step ?? 0.1}
        onChange={(event) => props.set(event.currentTarget.value)}
      />
    </label>
  );
}

function center(bounds: Bounds, axis: 'x' | 'y'): number {
  return axis === 'x' ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
}

function positiveInteger(raw: string): number {
  return Math.max(1, Math.floor(finiteNumber(raw)));
}

function nonNegative(raw: string): number {
  return Math.max(0, finiteNumber(raw));
}

function finiteNumber(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

const tabsStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 };
const tabStyle: React.CSSProperties = { minHeight: 32 };
const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 8, marginTop: 12 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 110px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkboxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
