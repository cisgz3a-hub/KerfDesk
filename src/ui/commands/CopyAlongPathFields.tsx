// The Copy Along Path dialog's settings (LightBurn gap LBG-T09): the guide,
// how the copies are placed, the offsets, rotation and the original.

import type { CopyAlongPathMode } from '../../core/geometry/copy-along-path';
import type { CopyAlongPathGuide } from '../../core/geometry/copy-along-path-guide';
import { artworkOperationName } from '../../core/scene/artwork-operation';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { NumberInput } from '../kit';

export type CopyAlongPathForm = {
  readonly mode: CopyAlongPathMode;
  readonly countText: string;
  readonly spacingText: string;
  readonly gapText: string;
  readonly startText: string;
  readonly endText: string;
  readonly rotateCopies: boolean;
  readonly keepOriginal: boolean;
};

type Patch = (patch: Partial<CopyAlongPathForm>) => void;

const MODES: ReadonlyArray<readonly [CopyAlongPathMode, string]> = [
  ['count', 'Number of copies'],
  ['spacing', 'Spacing between centres'],
  ['gap', 'Gap between copies'],
];

export function GuideField(props: {
  readonly guides: ReadonlyArray<CopyAlongPathGuide>;
  readonly guide: CopyAlongPathGuide | null;
  readonly onChange: (guideId: string) => void;
}): JSX.Element | null {
  if (props.guide === null) return null;
  if (props.guides.length < 2) {
    return (
      <p style={noteStyle}>
        Guide path: <strong>{guideLabel(props.guide)}</strong>
      </p>
    );
  }
  return (
    <label style={fieldStyle}>
      <span>Guide path</span>
      <select
        title="The path the copies follow. The top-most single path in the selection is picked first; everything else selected is copied."
        value={props.guide.object.id}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.guides.map((guide) => (
          <option key={guide.object.id} value={guide.object.id}>
            {guideLabel(guide)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlacementFields(props: {
  readonly form: CopyAlongPathForm;
  readonly closedGuide: boolean;
  readonly onChange: Patch;
}): JSX.Element {
  const { form, onChange } = props;
  return (
    <>
      <label style={fieldStyle}>
        <span>Place copies by</span>
        <select
          title="Choose how many copies there are: a set number spread over the path, or as many as fit at a set spacing or gap."
          value={form.mode}
          onChange={(event) => onChange({ mode: event.currentTarget.value as CopyAlongPathMode })}
        >
          {MODES.map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <AmountField form={form} onChange={onChange} />
      <NumberField
        label="Start offset (mm)"
        title="Distance along the path, from its start, to the first copy."
        value={form.startText}
        onChange={(startText) => onChange({ startText })}
      />
      <NumberField
        label="End offset (mm)"
        title={
          props.closedGuide
            ? 'A closed guide has no end: the copies go all the way round.'
            : 'Distance back from the end of the path to where the copies stop.'
        }
        value={form.endText}
        disabled={props.closedGuide}
        onChange={(endText) => onChange({ endText })}
      />
    </>
  );
}

export function OptionFields(props: {
  readonly form: CopyAlongPathForm;
  readonly onChange: Patch;
}): JSX.Element {
  return (
    <>
      <Check
        label="Rotate copies to follow the path"
        title="Turn each copy by the direction of the path where it sits."
        checked={props.form.rotateCopies}
        onChange={(rotateCopies) => props.onChange({ rotateCopies })}
      />
      <Check
        label="Keep the original"
        title="Leave the selected artwork where it is. Turn off to replace it with the copies; Undo brings it back."
        checked={props.form.keepOriginal}
        onChange={(keepOriginal) => props.onChange({ keepOriginal })}
      />
    </>
  );
}

export function guideLabel(guide: CopyAlongPathGuide): string {
  const shape = guide.closed ? 'closed' : 'open';
  return `${artworkOperationName(guide.object)} (${shape}, ${formatDisplayMillimetres(guide.walk.lengthMm)} mm)`;
}

function AmountField(props: {
  readonly form: CopyAlongPathForm;
  readonly onChange: Patch;
}): JSX.Element {
  const { form, onChange } = props;
  if (form.mode === 'count') {
    return (
      <NumberField
        label="Copies"
        title="How many copies to place along the path."
        value={form.countText}
        min={1}
        step={1}
        onChange={(countText) => onChange({ countText })}
      />
    );
  }
  if (form.mode === 'spacing') {
    return (
      <NumberField
        label="Spacing (mm)"
        title="Distance along the path from one copy's centre to the next."
        value={form.spacingText}
        onChange={(spacingText) => onChange({ spacingText })}
      />
    );
  }
  return (
    <NumberField
      label="Gap (mm)"
      title="Space along the path between one copy's edge and the next copy's edge."
      value={form.gapText}
      onChange={(gapText) => onChange({ gapText })}
    />
  );
}

function NumberField(props: {
  readonly label: string;
  readonly title: string;
  readonly value: string;
  readonly min?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <NumberInput
        value={props.value}
        min={props.min ?? 0}
        step={props.step ?? 0.1}
        title={props.title}
        disabled={props.disabled === true}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function Check(props: {
  readonly label: string;
  readonly title: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={checkStyle}>
      <input
        type="checkbox"
        title={props.title}
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) 190px',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
};
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 13 };
