// Circular array settings (ADR-307, LightBurn gap LBG-T14): the centre, which
// can be one of the selected objects, and how far round the circle the
// copies spread.

import type { ArrayCentre, CentreObjectOption } from './array-dialog-centre';
import type { ArrayForm, ArraySpread } from './array-dialog-form';
import {
  Check,
  Choice,
  Field,
  fieldStyle,
  fieldsStyle,
  type ArrayFormPatch,
} from './ArrayDialogFields';

const SPREAD: ReadonlyArray<readonly [ArraySpread, string]> = [
  ['full', 'Evenly all the way round'],
  ['end', 'From start to end angle'],
  ['step', 'By a step angle'],
];

export function CircularArrayFields(props: {
  readonly form: ArrayForm;
  /** What Center X and Y show: the typed point, or the chosen centre. */
  readonly shownCentre: { readonly x: string; readonly y: string };
  readonly centreObjects: ReadonlyArray<CentreObjectOption>;
  readonly onChange: ArrayFormPatch;
  readonly onCentre: (centre: ArrayCentre) => void;
  readonly onCenterField: (axis: 'x' | 'y', text: string) => void;
  readonly onSpread: (spread: ArraySpread) => void;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <div style={fieldsStyle}>
      <Field
        label="Copies"
        title="How many round the circle, the original included. The original becomes the first copy."
        value={form.count}
        min={1}
        step={1}
        set={(count) => onChange({ count })}
      />
      <CentreChoice centre={form.centre} objects={props.centreObjects} onChange={props.onCentre} />
      <Field
        label="Center X (mm)"
        title="The circle's centre. Typing here makes the centre a custom point."
        value={props.shownCentre.x}
        set={(text) => props.onCenterField('x', text)}
      />
      <Field
        label="Center Y (mm)"
        title="The circle's centre. Typing here makes the centre a custom point."
        value={props.shownCentre.y}
        set={(text) => props.onCenterField('y', text)}
      />
      <Field
        label="Radius (mm)"
        title="Distance from the centre to the middle of each copy."
        value={form.radius}
        min={0}
        set={(radius) => onChange({ radius })}
      />
      <Choice
        label="Spread copies"
        title="Spread the copies evenly all the way round, from the start angle to an end angle, or a set angle apart. Switching converts the angles, so the copies stay put until you change them."
        value={form.spread}
        options={SPREAD}
        set={props.onSpread}
      />
      <Field
        label="Start angle (deg)"
        title="Where the first copy goes. 0 is to the right of the centre and angles run clockwise, so 90 is below it."
        value={form.startAngle}
        set={(startAngle) => onChange({ startAngle })}
      />
      <ArcField form={form} onChange={onChange} />
      <Check
        label="Rotate copies around the circle"
        title="Rotate each copy to follow its position around the circle"
        checked={form.rotateCopies}
        set={(rotateCopies) => onChange({ rotateCopies })}
      />
    </div>
  );
}

function ArcField(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
}): JSX.Element | null {
  const { form, onChange } = props;
  if (form.spread === 'end') {
    return (
      <Field
        label="End angle (deg)"
        title="Where the last copy goes. When the end is a whole turn from the start, such as 0 to 360, the copies spread evenly and none is doubled at the end. An end below the start runs anticlockwise."
        value={form.endAngle}
        set={(endAngle) => onChange({ endAngle })}
      />
    );
  }
  if (form.spread === 'step') {
    return (
      <Field
        label="Step angle (deg)"
        title="Angle from one copy to the next. A negative step runs anticlockwise."
        value={form.stepAngle}
        set={(stepAngle) => onChange({ stepAngle })}
      />
    );
  }
  return null;
}

function CentreChoice(props: {
  readonly centre: ArrayCentre;
  readonly objects: ReadonlyArray<CentreObjectOption>;
  readonly onChange: (centre: ArrayCentre) => void;
}): JSX.Element {
  const value = props.centre.kind === 'object' ? `object:${props.centre.id}` : props.centre.kind;
  return (
    <label style={fieldStyle}>
      <span>Centre</span>
      <select
        title="Where the circle is centred: the middle of the selection, a point you type, or the centre of one selected object. A centre object stays where it is and is not copied."
        value={value}
        onChange={(event) => props.onChange(centreFromValue(event.currentTarget.value))}
      >
        <option value="selection">Selection centre</option>
        <option value="point">Custom point</option>
        {props.objects.length === 0 ? null : (
          <optgroup label="A selected object (stays put)">
            {props.objects.map((option) => (
              <option key={option.id} value={`object:${option.id}`}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function centreFromValue(value: string): ArrayCentre {
  if (value.startsWith('object:')) return { kind: 'object', id: value.slice('object:'.length) };
  return value === 'point' ? { kind: 'point' } : { kind: 'selection' };
}
