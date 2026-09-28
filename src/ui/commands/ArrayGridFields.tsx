// Grid array settings (ADR-307, LightBurn gap LBG-T13): rows and columns,
// the spacing as an edge gap or a centre distance, alternate-row and
// alternate-column shifts and mirrors, and which way the grid builds.

import type { ArrayMirrorAxes } from '../../core/scene/array-layout-types';
import type { ArrayForm } from './array-dialog-form';
import { Check, Choice, Field, fieldsStyle, type ArrayFormPatch } from './ArrayDialogFields';

const SPACE_BY: ReadonlyArray<readonly [ArrayForm['spaceBy'], string]> = [
  ['gap', 'Gap between copies'],
  ['centres', 'Distance between centres'],
];

const MIRROR: ReadonlyArray<readonly [ArrayMirrorAxes, string]> = [
  ['none', 'Off'],
  ['horizontal', 'Horizontally'],
  ['vertical', 'Vertically'],
  ['both', 'Both ways'],
];

export function GridArrayFields(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
  readonly onSpaceBy: (spaceBy: ArrayForm['spaceBy']) => void;
}): JSX.Element {
  const { form, onChange } = props;
  const centres = form.spaceBy === 'centres';
  return (
    <div style={fieldsStyle}>
      <Field
        label="Rows"
        title="How many rows, the original's row included."
        value={form.rows}
        min={1}
        step={1}
        set={(rows) => onChange({ rows })}
      />
      <Field
        label="Columns"
        title="How many in each row, the original included."
        value={form.columns}
        min={1}
        step={1}
        set={(columns) => onChange({ columns })}
      />
      <Choice
        label="Space by"
        title="Measure the spacing as the gap between copies' edges, or as the distance from one copy's centre to the next. Switching converts the numbers, so the grid stays the same until you change them."
        value={form.spaceBy}
        options={SPACE_BY}
        set={props.onSpaceBy}
      />
      <Field
        label="Horizontal spacing (mm)"
        title={
          centres
            ? "Distance from one copy's centre to the next, across. Less than the design's width overlaps the copies, as nesting triangles need."
            : "Gap between one copy's right edge and the next copy's left edge."
        }
        value={form.spacingX}
        min={0}
        set={(spacingX) => onChange({ spacingX })}
      />
      <Field
        label="Vertical spacing (mm)"
        title={
          centres
            ? "Distance from one copy's centre to the next, down. Less than the design's height overlaps the copies."
            : "Gap between one copy's bottom edge and the next copy's top edge."
        }
        value={form.spacingY}
        min={0}
        set={(spacingY) => onChange({ spacingY })}
      />
      <GridPatternFields form={form} onChange={onChange} />
    </div>
  );
}

function GridPatternFields(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <>
      <Field
        label="Row shift (mm)"
        title="Moves every other row (the 2nd, 4th, ...) right by this much, for brick and hex patterns. A negative value moves it left."
        value={form.rowShift}
        set={(rowShift) => onChange({ rowShift })}
      />
      <Field
        label="Column shift (mm)"
        title="Moves every other column (the 2nd, 4th, ...) down by this much. A negative value moves it up."
        value={form.columnShift}
        set={(columnShift) => onChange({ columnShift })}
      />
      <Choice
        label="Mirror alternate columns"
        title="Mirror every other column (the 2nd, 4th, ...), so shapes such as triangles nest point to base. Vertically flips top to bottom; Horizontally flips left to right."
        value={form.mirrorColumns}
        options={MIRROR}
        set={(mirrorColumns) => onChange({ mirrorColumns })}
      />
      <Choice
        label="Mirror alternate rows"
        title="Mirror every other row (the 2nd, 4th, ...). A copy in a mirrored row and a mirrored column gets both mirrors, and two in the same direction cancel out, which gives a checkerboard."
        value={form.mirrorRows}
        options={MIRROR}
        set={(mirrorRows) => onChange({ mirrorRows })}
      />
      <Check
        label="Build right to left"
        title="Place the columns to the left of the original instead of to the right. The original stays where it is."
        checked={form.reverseColumns}
        set={(reverseColumns) => onChange({ reverseColumns })}
      />
      <Check
        label="Build bottom to top"
        title="Place the rows above the original instead of below it. The original stays where it is."
        checked={form.reverseRows}
        set={(reverseRows) => onChange({ reverseRows })}
      />
    </>
  );
}
