// Grid array settings (ADR-307, LightBurn gap LBG-T13): rows and columns,
// the spacing as an edge gap or a centre distance, alternate-row and
// alternate-column shifts and mirrors, and which way the grid builds.

import { useState } from 'react';
import { gridCellSize } from '../../core/scene/array-grid-layout';
import type { ArrayMirrorAxes } from '../../core/scene/array-layout-types';
import type { Bounds } from '../../core/scene/scene-object';
import { spacingForTotal, type ArrayForm } from './array-dialog-form';
import { NumberInput } from '../kit';
import {
  Check,
  Choice,
  Field,
  fieldStyle,
  fieldsStyle,
  type ArrayFormPatch,
} from './ArrayDialogFields';

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
  readonly bounds: Bounds;
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
      <GridTotalFields form={form} onChange={onChange} bounds={props.bounds} />
      <GridPatternFields form={form} onChange={onChange} />
      <GridRandomFields form={form} onChange={onChange} />
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

const RANDOM: ReadonlyArray<readonly [ArrayForm['randomRotation'], string]> = [
  ['off', 'Off'],
  ['quarter', 'Quarter turns'],
  ['any', 'Any angle'],
];

// Total width and height: typing either sets the spacing that makes the grid that size.
function GridTotalFields(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
  readonly bounds: Bounds;
}): JSX.Element {
  const { form, onChange, bounds } = props;
  // The room each copy takes, so the total matches the grid random turns build.
  const { width, height } = gridCellSize(
    bounds,
    form.randomRotation === 'off'
      ? undefined
      : { seed: 0, stepDeg: form.randomRotation === 'quarter' ? 90 : 0 },
  );
  return (
    <>
      <TotalField
        label="Total width (mm)"
        title="The width of the whole grid. Typing a width sets the horizontal spacing that makes it."
        count={form.columns}
        countName="columns"
        size={width}
        spacing={form.spacingX}
        spaceBy={form.spaceBy}
        set={(spacingX) => onChange({ spacingX })}
      />
      <TotalField
        label="Total height (mm)"
        title="The height of the whole grid. Typing a height sets the vertical spacing that makes it."
        count={form.rows}
        countName="rows"
        size={height}
        spacing={form.spacingY}
        spaceBy={form.spaceBy}
        set={(spacingY) => onChange({ spacingY })}
      />
    </>
  );
}

// The total is shown from the spacing, but while the field is focused it keeps
// what is typed, so a half-typed number is not replaced by the recomputed one.
// Each keystroke that gives a valid total sets the spacing; leaving the field
// shows the total again.
function TotalField(props: {
  readonly label: string;
  readonly title: string;
  readonly count: string;
  readonly countName: string;
  readonly size: number;
  readonly spacing: string;
  readonly spaceBy: ArrayForm['spaceBy'];
  readonly set: (spacing: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const n = Math.max(1, Math.trunc(Number(props.count)) || 1);
  const gap = Number(props.spacing) || 0;
  const shown =
    props.spaceBy === 'centres' ? props.size + (n - 1) * gap : n * props.size + (n - 1) * gap;
  const spacingFor = (text: string): number | null =>
    text.trim() === ''
      ? null
      : spacingForTotal(Number(text), Math.trunc(Number(props.count)), props.size, props.spaceBy);
  const minimum = props.spaceBy === 'centres' ? props.size : n * props.size;
  const problem =
    draft === null || draft === shown.toFixed(2) || spacingFor(draft) !== null
      ? null
      : n < 2
        ? `Set at least 2 ${props.countName} to size the grid by its total.`
        : `Enter a total of at least ${minimum.toFixed(2)} mm.`;
  return (
    <>
      <label style={fieldStyle}>
        <span>{props.label}</span>
        <NumberInput
          value={draft ?? shown.toFixed(2)}
          title={props.title}
          min={0}
          step={0.1}
          onFocus={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setDraft(text);
            const spacing = spacingFor(text);
            if (spacing !== null) props.set(spacing.toFixed(3));
          }}
        />
      </label>
      {problem === null ? null : <p role="alert">{problem}</p>}
    </>
  );
}

function GridRandomFields(props: {
  readonly form: ArrayForm;
  readonly onChange: ArrayFormPatch;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <>
      <Choice
        label="Random orientation"
        title="Turn every copy but the original about its own centre by a random angle, for a scattered look or to vary grain direction. The seed fixes the pattern. A gap between copies is measured from the box any turn fits (width and height swapped for quarter turns, the diagonal for any angle), so turned copies do not overlap."
        value={form.randomRotation}
        options={RANDOM}
        set={(randomRotation) => onChange({ randomRotation })}
      />
      {form.randomRotation === 'off' ? null : (
        <Field
          label="Random seed"
          title="Change the seed for a different random pattern; the same seed always gives the same one."
          value={form.randomSeed}
          step={1}
          set={(randomSeed) => onChange({ randomSeed })}
        />
      )}
    </>
  );
}
