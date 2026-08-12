import { NumberInput } from '../kit';

type Setter = (value: string) => void;

export function GridArrayFields(props: {
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

export function PointRotationArrayFields(props: {
  readonly values: { count: string; totalAngle: string };
  readonly setters: { setCount: Setter; setTotalAngle: Setter };
}): JSX.Element {
  return (
    <div style={fieldsStyle}>
      <Field
        label="Copies (includes original)"
        value={props.values.count}
        min={1}
        step={1}
        set={props.setters.setCount}
      />
      <Field
        label="Total angle (deg)"
        value={props.values.totalAngle}
        set={props.setters.setTotalAngle}
      />
    </div>
  );
}

export function CircularArrayFields(props: {
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

const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 8, marginTop: 12 };
const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 110px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkboxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
