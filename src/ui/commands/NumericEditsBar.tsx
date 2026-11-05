import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  evaluateNumericEntry,
  type NumericEntryKind,
  type NumericEntryOptions,
  type NumericEntryResult,
} from '../../core/numeric-expression';
import {
  buildSelectionTransformEdit,
  selectionAnchorPoint,
  selectionMetrics,
  type SceneObject,
  type SelectionAnchor,
  type SelectionTransformEdit,
} from '../../core/scene';
import { useStore } from '../state';
import { useLengthUnit } from '../state/display-units';
import { lengthUnitLabel, MM_PER_INCH, type DisplayLengthUnit } from '../display-length';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { AspectLockButton, STRETCHED_IMAGE_NOTICE, stretchesImage } from './AspectLockButton';
import { TransformAnchorPicker } from './TransformAnchorPicker';
import './NumericEditsBar.css';

const DISPLAY_DECIMALS = 3;
const INCH_DISPLAY_DECIMALS = 4;
// The ArrowUp/ArrowDown nudge of an inch box: a hundredth of an inch.
const INCH_STEP_MM = MM_PER_INCH / 100;
// Longest slice of a refused entry echoed back in the error toast.
const ECHO_MAX_CHARS = 32;

// What each box accepts (LBG-F12): math and unit suffixes everywhere, a
// percentage of the current size in Width and Height only. `step` is the
// ArrowUp/ArrowDown nudge the old type="number" spinner gave, kept as an
// editing increment — never a policy that refuses off-grid values.
type EntrySpec = {
  readonly kind: NumericEntryKind;
  readonly percent: boolean;
  readonly step: number;
  readonly accepts: string;
  readonly retry: string;
};

const LENGTH_ACCEPTS =
  'Type a number in mm, math like 10+5 or 2*(3+4), or a unit like 1in or 2.5cm.';
const INCH_LENGTH_ACCEPTS =
  'Type a number in inches, math like 1/2+1/8 or 2*(3+4), or a unit like 10mm or 2.5cm.';
const LENGTH_RETRY =
  'Type a number, a sum like 10+5, a unit like 1in, or a percentage like 50% in Width or Height.';
const POSITION_ENTRY: EntrySpec = {
  kind: 'length',
  percent: false,
  step: 0.1,
  accepts: LENGTH_ACCEPTS,
  retry: LENGTH_RETRY,
};
const SIZE_ENTRY: EntrySpec = {
  ...POSITION_ENTRY,
  percent: true,
  accepts: `${LENGTH_ACCEPTS} A percentage like 50% scales the current size.`,
};
const ROTATION_ENTRY: EntrySpec = {
  kind: 'angle',
  percent: false,
  step: 1,
  accepts: 'Type an angle in degrees or math like 45+15, 360/7 or atan(3/4).',
  retry: 'Type a number of degrees or a sum like 45+15.',
};
// ADR-678: R turns a multi-object selection or a group as one piece. Objects
// turned to different angles leave it blank, and a typed angle turns them by it.
const ROTATION_HINT = 'Turns the whole selection about its centre.';
const MIXED_ROTATION_HINT =
  'The selected objects are turned to different angles, so the box is blank: an angle typed here turns them all by that much about the selection centre.';

export function NumericEditsBar(): JSX.Element {
  const model = useNumericEditModel();
  return (
    <section aria-label="Numeric Edits Toolbar" className="lf-numeric-edits">
      <div className="lf-numeric-edits-fields">
        <TransformAnchorPicker
          active={model.anchor}
          disabled={!model.hasSelection}
          onChange={model.setAnchor}
        />
        <NumericFields key={model.selectionKey} model={model} />
      </div>
    </section>
  );
}

type NumericEditModel = {
  readonly selectionKey: string;
  readonly anchor: SelectionAnchor;
  readonly setAnchor: (anchor: SelectionAnchor) => void;
  readonly preserveAspect: boolean;
  readonly setPreserveAspect: Dispatch<SetStateAction<boolean>>;
  readonly hasSelection: boolean;
  readonly xValue: number | null;
  readonly yValue: number | null;
  readonly widthValue: number | null;
  readonly heightValue: number | null;
  readonly rotationValue: number | null;
  readonly commit: (edit: SelectionTransformEdit) => void;
};

function useNumericEditModel(): NumericEditModel {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const applySelectionTransforms = useStore((state) => state.applySelectionTransforms);
  const pushToast = useToastStore((state) => state.pushToast);
  const anchor = useUiStore((state) => state.selectionAnchor);
  const setAnchor = useUiStore((state) => state.setSelectionAnchor);
  // Off by default: W and H are independent fields (LightBurn parity). Locking
  // is opt-in via the AR toggle — a default-on lock silently rescaled the other
  // dimension on every edit, so the operator could never set W and H apart.
  const [preserveAspect, setPreserveAspect] = useState(false);
  const objects = useMemo(
    () => selectedObjects(project.scene.objects, selectedObjectId, additionalSelectedIds),
    [project.scene.objects, selectedObjectId, additionalSelectedIds],
  );
  const metrics = selectionMetrics(objects);
  const anchorPoint = metrics === null ? null : selectionAnchorPoint(metrics.bbox, anchor);
  const commit = (edit: SelectionTransformEdit): void => {
    const result = buildSelectionTransformEdit(objects, edit);
    if (result.kind === 'error') {
      pushToast(messageForError(result.reason), 'warning');
      return;
    }
    applySelectionTransforms(result.transforms);
    if (stretchesImage(objects, edit)) pushToast(STRETCHED_IMAGE_NOTICE, 'info');
  };
  return {
    // A canvas pointerdown can select different artwork before field blur.
    // Retire the old fields so their draft cannot commit to that new selection.
    selectionKey: JSON.stringify([documentEpoch, objects.map((object) => object.id).sort()]),
    anchor,
    setAnchor,
    preserveAspect,
    setPreserveAspect,
    hasSelection: metrics !== null,
    xValue: anchorPoint === null ? null : anchorPoint.x,
    yValue: anchorPoint === null ? null : anchorPoint.y,
    widthValue: metrics === null ? null : metrics.width,
    heightValue: metrics === null ? null : metrics.height,
    rotationValue: metrics === null ? null : metrics.rotationDeg,
    commit,
  };
}

function NumericFields(props: { readonly model: NumericEditModel }): JSX.Element {
  const { model } = props;
  const lengthUnit = useLengthUnit();
  const mixedRotation = model.hasSelection && model.rotationValue === null;
  return (
    <>
      <div className="lf-numeric-field-group">
        <NumberField
          label="Selection X position"
          caption="X"
          value={model.xValue}
          disabled={!model.hasSelection}
          lengthUnit={lengthUnit}
          hideUnit
          entry={POSITION_ENTRY}
          onCommit={(x) => model.commit({ kind: 'position', anchor: model.anchor, x })}
        />
        <NumberField
          label="Selection Y position"
          caption="Y"
          value={model.yValue}
          disabled={!model.hasSelection}
          lengthUnit={lengthUnit}
          entry={POSITION_ENTRY}
          onCommit={(y) => model.commit({ kind: 'position', anchor: model.anchor, y })}
        />
      </div>
      <span className="lf-numeric-edit-divider" aria-hidden="true" />
      <SizeFields model={model} lengthUnit={lengthUnit} />
      <span className="lf-numeric-edit-divider" aria-hidden="true" />
      <NumberField
        label="Selection rotation"
        caption="R"
        value={model.rotationValue}
        disabled={!model.hasSelection}
        unit="°"
        hint={mixedRotation ? MIXED_ROTATION_HINT : ROTATION_HINT}
        placeholder={mixedRotation ? 'Mixed' : ''}
        entry={ROTATION_ENTRY}
        onCommit={(rotationDeg) => model.commit({ kind: 'rotate', rotationDeg })}
      />
    </>
  );
}

function SizeFields({
  model,
  lengthUnit,
}: {
  readonly model: NumericEditModel;
  readonly lengthUnit: DisplayLengthUnit;
}): JSX.Element {
  return (
    <div className="lf-numeric-field-group">
      <NumberField
        label="Selection width"
        caption="W"
        value={model.widthValue}
        disabled={!model.hasSelection}
        lengthUnit={lengthUnit}
        hideUnit
        entry={SIZE_ENTRY}
        onCommit={(width) =>
          model.commit({
            kind: 'resize',
            anchor: model.anchor,
            width,
            preserveAspect: model.preserveAspect,
          })
        }
      />
      <AspectLockButton
        locked={model.preserveAspect}
        disabled={!model.hasSelection}
        onToggle={() => model.setPreserveAspect((value) => !value)}
      />
      <NumberField
        label="Selection height"
        caption="H"
        value={model.heightValue}
        disabled={!model.hasSelection}
        lengthUnit={lengthUnit}
        entry={SIZE_ENTRY}
        onCommit={(height) =>
          model.commit({
            kind: 'resize',
            anchor: model.anchor,
            height,
            preserveAspect: model.preserveAspect,
          })
        }
      />
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly caption: string;
  readonly value: number | null;
  readonly disabled: boolean;
  /** Rotation names its unit; length boxes follow the display unit (ADR-629). */
  readonly unit?: string;
  readonly lengthUnit?: DisplayLengthUnit;
  readonly hideUnit?: boolean;
  /** What the box does; length boxes measure from the anchor point. */
  readonly hint?: string;
  readonly placeholder?: string;
  readonly entry: EntrySpec;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const lengthUnit = props.lengthUnit;
  const format = (value: number | null): string => formatNumber(value, lengthUnit);
  const unitLabel = lengthUnit === undefined ? (props.unit ?? '') : lengthUnitLabel(lengthUnit);
  const step = lengthUnit === 'in' ? INCH_STEP_MM : props.entry.step;
  const shown = format(props.value);
  const [draft, setDraft] = useState(shown);
  const [draftIsValid, setDraftIsValid] = useState(true);
  // Re-snap on every commit ATTEMPT, not only when the value moved. A commit
  // the store rejects (resizing a rotated selection, a zero dimension) or
  // normalizes to what it already held (370° on a 10° shape) leaves
  // `props.value` untouched, so keying the effect on it alone left the box
  // showing a number the scene never took — the lie useDebouncedCommit's blur
  // re-snap exists to prevent.
  const [commitSeq, setCommitSeq] = useState(0);
  useEffect(() => {
    setDraft(formatNumber(props.value, lengthUnit));
    setDraftIsValid(true);
  }, [props.value, commitSeq, lengthUnit]);
  const evaluate = (text: string): NumericEntryResult =>
    evaluateNumericEntry(text, entryOptions(props.entry, props.value, lengthUnit));
  const updateDraft = (text: string): void => {
    setDraft(text);
    setDraftIsValid(evaluate(text).kind === 'ok');
  };
  const commit = (text: string): void => {
    const result = evaluate(text);
    setCommitSeq((seq) => seq + 1);
    if (result.kind === 'ok') {
      props.onCommit(result.value);
      return;
    }
    // A blank box is the operator backing out, as it always was: it snaps
    // back without a toast. Anything else they typed deserves a reason.
    if (text.trim() !== '') pushEntryError(text, result.message, props.entry);
  };
  // Tabbing or clicking through a box leaves its text as shown, which is no
  // edit. Committing it anyway rounded the value to the shown decimals, added
  // an undo step and could warn about a rotated selection for nothing.
  const commitIfEdited = (text: string): void => {
    if (text.trim() !== shown) commit(text);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void =>
    handleFieldKey(event, {
      commitIfEdited,
      revert: () => {
        setDraft(shown);
        setDraftIsValid(true);
      },
      stepped: (key, text) => steppedDraft(key, evaluate(text), step, format),
      updateDraft,
    });
  return (
    <label className="lf-numeric-edit-field">
      <span className="lf-numeric-edit-caption">{props.caption}</span>
      <input
        className="lf-input"
        aria-label={props.label}
        title={fieldTitle(props.label, props.hint, props.entry, lengthUnit)}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={props.placeholder}
        value={draft}
        disabled={props.disabled}
        aria-invalid={!draftIsValid}
        onInput={(event) => updateDraft(event.currentTarget.value)}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onBlur={(event) => commitIfEdited(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {!props.hideUnit && <span className="lf-numeric-edit-unit">{unitLabel}</span>}
    </label>
  );
}

// The hover text: what the box does, then what it accepts in the display unit.
function fieldTitle(
  label: string,
  hint: string | undefined,
  entry: EntrySpec,
  lengthUnit: DisplayLengthUnit | undefined,
): string {
  const accepts =
    lengthUnit === 'in'
      ? entry.accepts.replace(LENGTH_ACCEPTS, INCH_LENGTH_ACCEPTS)
      : entry.accepts;
  return `${label}. ${hint ?? 'Values are measured from the selected anchor point.'} ${accepts}`;
}

type FieldKeyActions = {
  readonly commitIfEdited: (text: string) => void;
  readonly revert: () => void;
  readonly stepped: (key: string, text: string) => string | null;
  readonly updateDraft: (text: string) => void;
};

function handleFieldKey(
  event: React.KeyboardEvent<HTMLInputElement>,
  actions: FieldKeyActions,
): void {
  if (event.key === 'Enter') {
    // Enter on the text as shown is no edit either: in an inch box it would
    // write back the four-decimal rounding (10 mm shown as 0.3937).
    actions.commitIfEdited(event.currentTarget.value);
    return;
  }
  if (event.key === 'Escape') {
    // Esc abandons the typed text, as the node and compound boxes do, so
    // leaving the box afterwards applies nothing (audit 08-P3-7).
    event.stopPropagation();
    actions.revert();
    return;
  }
  const stepped = actions.stepped(event.key, event.currentTarget.value);
  if (stepped === null) return;
  event.preventDefault();
  actions.updateDraft(stepped);
}

function entryOptions(
  entry: EntrySpec,
  current: number | null,
  lengthUnit: DisplayLengthUnit | undefined,
): NumericEntryOptions {
  const unit = lengthUnit === undefined ? {} : { lengthUnit };
  return entry.percent && current !== null
    ? { kind: entry.kind, percentOf: current, ...unit }
    : { kind: entry.kind, ...unit };
}

// ArrowUp/ArrowDown nudge a readable draft by one step without committing,
// as the old number spinner did; Enter or blur still commits.
function steppedDraft(
  key: string,
  current: NumericEntryResult,
  step: number,
  format: (value: number) => string,
): string | null {
  const direction = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  if (direction === 0 || current.kind !== 'ok') return null;
  return format(current.value + direction * step);
}

function pushEntryError(text: string, reason: string, entry: EntrySpec): void {
  const typed = text.trim();
  const echo = typed.length > ECHO_MAX_CHARS ? `${typed.slice(0, ECHO_MAX_CHARS)}…` : typed;
  useToastStore.getState().pushToast(`Couldn't read "${echo}": ${reason}. ${entry.retry}`, 'error');
}

function selectedObjects(
  objects: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  const ids = new Set([
    ...(selectedObjectId === null ? [] : [selectedObjectId]),
    ...additionalSelectedIds,
  ]);
  return objects.filter((object) => ids.has(object.id));
}

// Length boxes show the display unit (ADR-629); rotation shows degrees.
function formatNumber(value: number | null, lengthUnit?: DisplayLengthUnit): string {
  if (value === null) return '';
  if (lengthUnit === 'in')
    return Number((value / MM_PER_INCH).toFixed(INCH_DISPLAY_DECIMALS)).toString();
  return Number(value.toFixed(DISPLAY_DECIMALS)).toString();
}

function messageForError(reason: string): string {
  if (reason === 'non-uniform-rotated-selection') {
    return 'Unlocked width/height edits need every selected object turned by a multiple of 90°. Lock the aspect ratio to scale evenly.';
  }
  if (reason === 'invalid-dimension') return 'Width and height must be greater than 0.';
  if (reason === 'invalid-number') return 'Numeric values must be finite.';
  if (reason === 'zero-height-selection') {
    return 'The selection has no height to scale, like a horizontal line. Change its width instead.';
  }
  if (reason === 'zero-width-selection') {
    return 'The selection has no width to scale, like a vertical line. Change its height instead.';
  }
  if (reason === 'degenerate-selection') return 'The selection has no width or height to scale.';
  return 'Numeric edit could not be applied.';
}
