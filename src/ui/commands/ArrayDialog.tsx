import { useMemo, useState } from 'react';
import type { ArraySpec } from '../../core/scene/array-layout-types';
import { combinedBBox } from '../../core/scene/hit-test';
import type { Scene } from '../../core/scene/scene';
import type { Bounds, SceneObject } from '../../core/scene/scene-object';
import { arrayCopiedIds, arraySpecRoomProblem } from '../state/array-room';
import { sceneCopyRoom } from '../state/scene-copy-room';
import { Button, Dialog, DialogActions } from '../kit';
import {
  centreObjectOptions,
  displayedCentre,
  type ArrayDialogContext,
} from './array-dialog-centre';
import {
  arraySpecFromForm,
  defaultArrayForm,
  withCenterField,
  withCentre,
  withSpaceBy,
  withSpread,
  type ArrayForm,
} from './array-dialog-form';
import { arraySummary } from './array-dialog-summary';
import { CircularArrayFields } from './ArrayCircularFields';
import { PointRotationArrayFields } from './ArrayDialogFields';
import { GridArrayFields } from './ArrayGridFields';

const NO_OBJECTS: ReadonlyArray<SceneObject> = [];

export function ArrayDialog(props: {
  readonly selectionBounds: Bounds;
  /** The project's scene: how many copies it has room for (ADR-307 amendment 1). */
  readonly scene: Scene;
  /** The selection in stacking order; lets a circular array centre on one of its objects. */
  readonly selected?: ReadonlyArray<SceneObject>;
  /** Settings to open with, such as the ones last applied; the defaults when absent. */
  readonly initial?: ArrayForm;
  readonly title?: string;
  readonly actionLabel?: string;
  readonly onCancel: () => void;
  /** The settings behind the request, just before `onApply`. */
  readonly onSubmitForm?: (form: ArrayForm) => void;
  readonly initialAdvanceVariables?: boolean;
  readonly onApply: (spec: ArraySpec, advanceVariables?: boolean) => void;
  readonly onRetainChange?: (name: string | undefined) => void;
  readonly hasVariableText?: boolean;
  readonly errorMessage?: string;
  readonly preparing?: boolean;
}): JSX.Element {
  const selected = props.selected ?? NO_OBJECTS;
  const context = useMemo<ArrayDialogContext>(
    () => ({ bounds: props.selectionBounds, selected }),
    [props.selectionBounds, selected],
  );
  const centreObjects = useMemo(() => centreObjectOptions(selected), [selected]);
  const [form, setForm] = useState(() => props.initial ?? defaultArrayForm(props.selectionBounds));
  const [advanceVariables, setAdvanceVariables] = useState(props.initialAdvanceVariables ?? false);
  const spec = arraySpecFromForm(form, context);
  const problem = useRoomProblem(props.scene, selected, spec);
  const onChange = (patch: Partial<ArrayForm>): void =>
    setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      title={props.title ?? 'Array'}
      size="sm"
      as="form"
      onClose={props.onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem !== null) return;
        props.onSubmitForm?.(form);
        return advanceVariables ? props.onApply(spec, true) : props.onApply(spec);
      }}
    >
      <ArrayModes mode={form.mode} onChange={(mode) => onChange({ mode })} />
      <ArrayFields
        form={form}
        context={context}
        centreObjects={centreObjects}
        setForm={setForm}
        onChange={onChange}
      />
      <VariableArrayOption
        visible={props.hasVariableText === true}
        hint={variableArrayHint(form)}
        checked={advanceVariables}
        onChange={setAdvanceVariables}
      />
      {props.onRetainChange === undefined ? null : (
        <RetainedArrayOption onChange={props.onRetainChange} />
      )}
      <p role="status" aria-live="polite" style={statusStyle}>
        {props.preparing === true
          ? 'Preparing variable copies…'
          : (problem ?? summaryFor(spec, context))}
      </p>
      {props.errorMessage === undefined ? null : <p role="alert">{props.errorMessage}</p>}
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={problem !== null || props.preparing === true}
        >
          {props.actionLabel ?? 'Create array'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RetainedArrayOption(props: {
  readonly onChange: (name: string | undefined) => void;
}): JSX.Element {
  const [retained, setRetained] = useState(false);
  const [name, setName] = useState('Array');
  return (
    <div>
      <label>
        <input
          type="checkbox"
          title="Capture this array's source and layout settings so count or spacing can be regenerated later."
          checked={retained}
          onChange={(event) => {
            const value = event.currentTarget.checked;
            setRetained(value);
            props.onChange(value ? name : undefined);
          }}
        />{' '}
        Keep editable array settings
      </label>
      {retained ? (
        <label>
          Array name
          <input
            className="lf-input"
            aria-label="Array name"
            title="Name the retained layout so you can find its settings when regenerating or expanding the array."
            maxLength={200}
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value);
              props.onChange(event.currentTarget.value);
            }}
          />
        </label>
      ) : null}
      <p>
        Retained settings survive saving. Regenerate count or spacing from the captured source.
        Expand to independent copies when individual edits need to remain.
      </p>
    </div>
  );
}

// Why the request as typed does not fit the project, or null when it does
// (ADR-307 amendment 1). It is counted from the numbers alone, without laying
// any copy out, so whatever is typed costs the same. A circle centred on a
// selected object copies the rest of the selection.
function useRoomProblem(
  scene: Scene,
  selected: ReadonlyArray<SceneObject>,
  spec: ArraySpec,
): string | null {
  const centreId = spec.kind === 'circular' ? spec.centerObjectId : undefined;
  const room = useMemo(
    () =>
      sceneCopyRoom(scene, arrayCopiedIds(new Set(selected.map((object) => object.id)), centreId)),
    [scene, selected, centreId],
  );
  return arraySpecRoomProblem(room, spec);
}

function ArrayFields(props: {
  readonly form: ArrayForm;
  readonly context: ArrayDialogContext;
  readonly centreObjects: ReturnType<typeof centreObjectOptions>;
  readonly setForm: (update: (current: ArrayForm) => ArrayForm) => void;
  readonly onChange: (patch: Partial<ArrayForm>) => void;
}): JSX.Element {
  const { form, context, setForm, onChange } = props;
  if (form.mode === 'grid') {
    return (
      <GridArrayFields
        form={form}
        onChange={onChange}
        onSpaceBy={(spaceBy) => setForm((current) => withSpaceBy(current, spaceBy, context.bounds))}
      />
    );
  }
  if (form.mode === 'point-rotation') {
    return <PointRotationArrayFields form={form} onChange={onChange} />;
  }
  return (
    <CircularArrayFields
      form={form}
      shownCentre={displayedCentre(form, context)}
      centreObjects={props.centreObjects}
      onChange={onChange}
      onCentre={(centre) => setForm((current) => withCentre(current, centre, context))}
      onCenterField={(axis, text) =>
        setForm((current) => withCenterField(current, axis, text, context))
      }
      onSpread={(spread) => setForm((current) => withSpread(current, spread, context))}
    />
  );
}

// A circle centred on a selected object copies the rest of the selection.
function summaryFor(spec: ArraySpec, context: ArrayDialogContext): string {
  const centreId = spec.kind === 'circular' ? spec.centerObjectId : undefined;
  const copied =
    centreId === undefined
      ? context.bounds
      : (combinedBBox(context.selected.filter((object) => object.id !== centreId)) ??
        context.bounds);
  return arraySummary(spec, copied);
}

function ArrayModes(props: {
  readonly mode: ArraySpec['kind'];
  readonly onChange: (mode: ArraySpec['kind']) => void;
}): JSX.Element {
  return (
    <div role="tablist" aria-label="Array type" style={tabsStyle}>
      <ModeButton
        active={props.mode === 'grid'}
        label="Grid"
        onClick={() => props.onChange('grid')}
      />
      <ModeButton
        active={props.mode === 'point-rotation'}
        label="Point Rotation"
        onClick={() => props.onChange('point-rotation')}
      />
      <ModeButton
        active={props.mode === 'circular'}
        label="Circular"
        onClick={() => props.onChange('circular')}
      />
    </div>
  );
}

function VariableArrayOption(props: {
  readonly visible: boolean;
  readonly hint: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element | null {
  if (!props.visible) return null;
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
      <label>
        <input
          type="checkbox"
          checked={props.checked}
          title="Assign each array copy a variable record using the current range and advance settings."
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />{' '}
        Advance variables per copy
      </label>
      {props.checked ? (
        <p style={{ margin: 0, fontSize: 13 }}>
          {props.hint} Values use Advance by and wrap at range ends. Later data changes keep your
          placements; preview again. Creating copies does not advance the current record.
        </p>
      ) : null}
    </div>
  );
}

function variableArrayHint(form: ArrayForm): string {
  switch (form.mode) {
    case 'grid':
      return form.spaceBy === 'centres'
        ? 'Records follow the copies along each row, then row by row. The centre distances stay fixed, so wide values can overlap.'
        : 'Records follow the copies along each row, then row by row. Spacing fits all current values.';
    case 'circular':
      return 'Records follow the copies round from the start angle. Each copy is centred on the chosen ring. The radius stays fixed, so wide copies can overlap.';
    case 'point-rotation':
      return 'Records start at the original placement and follow the signed total angle. All copies share the first evaluated design’s centre. Rotated copies can overlap.';
  }
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

const tabsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 4,
};
const tabStyle: React.CSSProperties = { minHeight: 32 };
const statusStyle: React.CSSProperties = { fontSize: 13, marginBottom: 0 };
