import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import lock from 'lucide-static/icons/lock-keyhole.svg?raw';
import unlock from 'lucide-static/icons/lock-keyhole-open.svg?raw';
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
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { TransformAnchorPicker } from './TransformAnchorPicker';
import './NumericEditsBar.css';

const DISPLAY_DECIMALS = 3;
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
        <NumericFields model={model} />
      </div>
    </section>
  );
}

type NumericEditModel = {
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
  };
  return {
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
  return (
    <>
      <div className="lf-numeric-field-group">
        <NumberField
          label="Selection X position"
          caption="X"
          value={model.xValue}
          disabled={!model.hasSelection}
          unit="mm"
          hideUnit
          entry={POSITION_ENTRY}
          onCommit={(x) => model.commit({ kind: 'position', anchor: model.anchor, x })}
        />
        <NumberField
          label="Selection Y position"
          caption="Y"
          value={model.yValue}
          disabled={!model.hasSelection}
          unit="mm"
          entry={POSITION_ENTRY}
          onCommit={(y) => model.commit({ kind: 'position', anchor: model.anchor, y })}
        />
      </div>
      <span className="lf-numeric-edit-divider" aria-hidden="true" />
      <SizeFields model={model} />
      <span className="lf-numeric-edit-divider" aria-hidden="true" />
      <NumberField
        label="Selection rotation"
        caption="R"
        value={model.rotationValue}
        disabled={model.rotationValue === null}
        unit="°"
        entry={ROTATION_ENTRY}
        onCommit={(rotationDeg) => model.commit({ kind: 'rotate', rotationDeg })}
      />
    </>
  );
}

function SizeFields({ model }: { readonly model: NumericEditModel }): JSX.Element {
  return (
    <div className="lf-numeric-field-group">
      <NumberField
        label="Selection width"
        caption="W"
        value={model.widthValue}
        disabled={!model.hasSelection}
        unit="mm"
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
      <button
        type="button"
        className="lf-btn lf-numeric-aspect-lock"
        aria-label="Lock aspect ratio"
        title="Keep width and height proportional when resizing the selection."
        aria-pressed={model.preserveAspect}
        disabled={!model.hasSelection}
        onClick={() => model.setPreserveAspect((value) => !value)}
      >
        <span
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: model.preserveAspect ? lock : unlock }}
        />
      </button>
      <NumberField
        label="Selection height"
        caption="H"
        value={model.heightValue}
        disabled={!model.hasSelection}
        unit="mm"
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
  readonly unit: string;
  readonly hideUnit?: boolean;
  readonly entry: EntrySpec;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const shown = formatNumber(props.value);
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
    setDraft(formatNumber(props.value));
    setDraftIsValid(true);
  }, [props.value, commitSeq]);
  const evaluate = (text: string): NumericEntryResult =>
    evaluateNumericEntry(text, entryOptions(props.entry, props.value));
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
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      commit(event.currentTarget.value);
      return;
    }
    const stepped = steppedDraft(event.key, evaluate(event.currentTarget.value), props.entry.step);
    if (stepped === null) return;
    event.preventDefault();
    updateDraft(stepped);
  };
  return (
    <label className="lf-numeric-edit-field">
      <span className="lf-numeric-edit-caption">{props.caption}</span>
      <input
        className="lf-input"
        aria-label={props.label}
        title={`${props.label}. Values are measured from the selected anchor point. ${props.entry.accepts}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        disabled={props.disabled}
        aria-invalid={!draftIsValid}
        onInput={(event) => updateDraft(event.currentTarget.value)}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onBlur={(event) => commitIfEdited(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {!props.hideUnit && <span className="lf-numeric-edit-unit">{props.unit}</span>}
    </label>
  );
}

function entryOptions(entry: EntrySpec, current: number | null): NumericEntryOptions {
  return entry.percent && current !== null
    ? { kind: entry.kind, percentOf: current }
    : { kind: entry.kind };
}

// ArrowUp/ArrowDown nudge a readable draft by one step without committing,
// as the old number spinner did; Enter or blur still commits.
function steppedDraft(key: string, current: NumericEntryResult, step: number): string | null {
  const direction = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
  if (direction === 0 || current.kind !== 'ok') return null;
  return formatNumber(current.value + direction * step);
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

function formatNumber(value: number | null): string {
  return value === null ? '' : Number(value.toFixed(DISPLAY_DECIMALS)).toString();
}

function messageForError(reason: string): string {
  if (reason === 'non-uniform-rotated-selection') {
    return 'Unlocked width/height edits are disabled for rotated selections.';
  }
  if (reason === 'multi-rotation') return 'Rotate one object at a time in Numeric Edits.';
  if (reason === 'invalid-dimension') return 'Width and height must be greater than 0.';
  if (reason === 'invalid-number') return 'Numeric values must be finite.';
  return 'Numeric edit could not be applied.';
}
