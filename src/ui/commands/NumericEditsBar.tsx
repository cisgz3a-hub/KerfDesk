import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import lock from 'lucide-static/icons/lock-keyhole.svg?raw';
import unlock from 'lucide-static/icons/lock-keyhole-open.svg?raw';
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

const FIELD_STEP_MM = 0.1;
const ROTATION_STEP_DEG = 1;
const DISPLAY_DECIMALS = 3;

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
          onCommit={(x) => model.commit({ kind: 'position', anchor: model.anchor, x })}
        />
        <NumberField
          label="Selection Y position"
          caption="Y"
          value={model.yValue}
          disabled={!model.hasSelection}
          unit="mm"
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
        step={ROTATION_STEP_DEG}
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
  readonly step?: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(formatNumber(props.value));
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
  const updateDraft = (input: HTMLInputElement): void => {
    setDraft(input.value);
    setDraftIsValid(numericInputIsValid(input));
  };
  const commit = (input: HTMLInputElement): void => {
    const next = Number(input.value);
    setCommitSeq((seq) => seq + 1);
    if (!numericInputIsValid(input)) return;
    props.onCommit(next);
  };
  return (
    <label className="lf-numeric-edit-field">
      <span className="lf-numeric-edit-caption">{props.caption}</span>
      <input
        className="lf-input"
        aria-label={props.label}
        title={`${props.label}. Values are measured from the selected anchor point.`}
        type="number"
        step={props.step ?? FIELD_STEP_MM}
        value={draft}
        disabled={props.disabled}
        aria-invalid={!draftIsValid}
        onInput={(event) => updateDraft(event.currentTarget)}
        onChange={(event) => updateDraft(event.currentTarget)}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget);
        }}
      />
      {!props.hideUnit && <span className="lf-numeric-edit-unit">{props.unit}</span>}
    </label>
  );
}

function numericInputIsValid(input: HTMLInputElement): boolean {
  const value = input.value.trim();
  // The step attribute is an editing affordance for the spinner, not a value
  // policy. Valid finite values such as 0.05 mm and 10.5 degrees must not be
  // refused merely because they do not land on 0.1/1 increments. Browser
  // number inputs expose unparseable native drafts as blank/badInput; those
  // and non-finite values are the only input-level failures here.
  return value !== '' && !input.validity.badInput && Number.isFinite(Number(value));
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
