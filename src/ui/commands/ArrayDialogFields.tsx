// The Array dialog's field rows, shared by its three modes, and the Point
// Rotation settings.

import { NumberInput } from '../kit';
import type { ArrayForm } from './array-dialog-form';

export type ArrayFormPatch = (patch: Partial<ArrayForm>) => void;

export function PointRotationArrayFields(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
}): JSX.Element {
  return (
    <div style={fieldsStyle}>
      <Field
        label="Copies (includes original)"
        title="How many there will be, the original included. The original stays where it is."
        value={props.form.count}
        min={1}
        step={1}
        set={(count) => props.onChange({ count })}
      />
      <Field
        label="Total angle (deg)"
        title="The angle the copies share, turning about the selection centre. 360 turns them all the way round without doubling the original; a negative angle turns the other way."
        value={props.form.totalAngle}
        set={(totalAngle) => props.onChange({ totalAngle })}
      />
    </div>
  );
}

export function Field(props: {
  readonly label: string;
  readonly title: string;
  readonly value: string;
  readonly min?: number;
  readonly step?: number;
  readonly set: (value: string) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <NumberInput
        value={props.value}
        title={props.title}
        {...(props.min === undefined ? {} : { min: props.min })}
        step={props.step ?? 0.1}
        onChange={(event) => props.set(event.currentTarget.value)}
      />
    </label>
  );
}

export function Choice<T extends string>(props: {
  readonly label: string;
  readonly title: string;
  readonly value: T;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly set: (value: T) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <select
        title={props.title}
        value={props.value}
        onChange={(event) => {
          const chosen = props.options.find(([value]) => value === event.currentTarget.value);
          if (chosen !== undefined) props.set(chosen[0]);
        }}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check(props: {
  readonly label: string;
  readonly title: string;
  readonly checked: boolean;
  readonly set: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkboxStyle}>
      <input
        type="checkbox"
        title={props.title}
        checked={props.checked}
        onChange={(event) => props.set(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

export const fieldsStyle: React.CSSProperties = { display: 'grid', gap: 8, marginTop: 12 };
export const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 190px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkboxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
