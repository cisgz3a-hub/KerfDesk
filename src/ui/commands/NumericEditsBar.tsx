import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
import { JobSafetyControls } from '../laser/JobSafetyControls';

const FIELD_STEP_MM = 0.1;
const ROTATION_STEP_DEG = 1;
const DISPLAY_DECIMALS = 3;

const ANCHORS: ReadonlyArray<SelectionAnchor> = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

const ANCHOR_NAMES: Readonly<Record<SelectionAnchor, string>> = {
  nw: 'top left',
  n: 'top center',
  ne: 'top right',
  w: 'middle left',
  c: 'center',
  e: 'middle right',
  sw: 'bottom left',
  s: 'bottom center',
  se: 'bottom right',
};

export function NumericEditsBar(): JSX.Element {
  const model = useNumericEditModel();
  return (
    <section aria-label="Numeric Edits Toolbar" style={barStyle}>
      <div style={editsGroupStyle}>
        <AnchorGrid
          active={model.anchor}
          disabled={!model.hasSelection}
          onChange={model.setAnchor}
        />
        <NumericFields model={model} />
      </div>
      <JobSafetyControls />
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
  const [preserveAspect, setPreserveAspect] = useState(true);
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
      <NumberField
        label="Selection X position"
        caption="X"
        value={model.xValue}
        disabled={!model.hasSelection}
        unit="mm"
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
      <NumberField
        label="Selection width"
        caption="W"
        value={model.widthValue}
        disabled={!model.hasSelection}
        unit="mm"
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
        className="lf-btn lf-iconbtn lf-iconbtn--sm"
        aria-label="Lock aspect ratio"
        title="Keep width and height proportional when resizing the selection."
        aria-pressed={model.preserveAspect}
        disabled={!model.hasSelection}
        onClick={() => model.setPreserveAspect((value) => !value)}
      >
        AR
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
      <NumberField
        label="Selection rotation"
        caption="R"
        value={model.rotationValue}
        disabled={model.rotationValue === null}
        unit="deg"
        step={ROTATION_STEP_DEG}
        onCommit={(rotationDeg) =>
          model.commit({ kind: 'rotate', anchor: model.anchor, rotationDeg })
        }
      />
    </>
  );
}

function AnchorGrid(props: {
  readonly active: SelectionAnchor;
  readonly disabled: boolean;
  readonly onChange: (anchor: SelectionAnchor) => void;
}): JSX.Element {
  return (
    <div aria-label="Transform anchor" style={anchorGridStyle}>
      {ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          className="lf-btn lf-iconbtn lf-iconbtn--sm"
          aria-label={`Transform anchor: ${ANCHOR_NAMES[anchor]}`}
          title={anchorTitle(anchor)}
          aria-pressed={props.active === anchor}
          disabled={props.disabled}
          onClick={() => props.onChange(anchor)}
        >
          <span aria-hidden="true" style={anchorMarkerStyle} />
        </button>
      ))}
    </div>
  );
}

function anchorTitle(anchor: SelectionAnchor): string {
  return `Use the selection ${anchorPointName(anchor)} point as the X/Y reference, resize anchor, and rotation pivot.`;
}

function anchorPointName(anchor: SelectionAnchor): string {
  switch (anchor) {
    case 'nw':
      return 'top-left';
    case 'n':
      return 'top';
    case 'ne':
      return 'top-right';
    case 'w':
      return 'left';
    case 'c':
      return 'center';
    case 'e':
      return 'right';
    case 'sw':
      return 'bottom-left';
    case 's':
      return 'bottom';
    case 'se':
      return 'bottom-right';
  }
}

function NumberField(props: {
  readonly label: string;
  readonly caption: string;
  readonly value: number | null;
  readonly disabled: boolean;
  readonly unit: string;
  readonly step?: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(formatNumber(props.value));
  useEffect(() => setDraft(formatNumber(props.value)), [props.value]);
  const commit = (): void => {
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(formatNumber(props.value));
      return;
    }
    props.onCommit(next);
  };
  return (
    <label style={fieldStyle}>
      <span style={captionStyle}>{props.caption}</span>
      <input
        className="lf-input"
        aria-label={props.label}
        title={`${props.label}. Values are measured from the selected anchor point.`}
        type="number"
        step={props.step ?? FIELD_STEP_MM}
        value={draft}
        disabled={props.disabled}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        style={inputStyle}
      />
      <span style={unitStyle}>{props.unit}</span>
    </label>
  );
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

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  gap: 8,
  padding: '4px 12px',
  background: 'var(--lf-bg-1)',
  borderBottom: '1px solid var(--lf-border)',
  fontSize: 12,
};
// Only the transform controls scroll horizontally; the job-safety cluster is a
// non-scrolling sibling so the ABORT button can never be pushed out of reach
// when the fields overflow a narrow window.
const editsGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  flex: '1 1 auto',
  overflowX: 'auto',
  overflowY: 'hidden',
  gap: 8,
};
const anchorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 22px)',
  gap: 2,
};
const anchorMarkerStyle: React.CSSProperties = {
  display: 'block',
  width: 7,
  height: 7,
  borderRadius: 2,
  background: 'currentColor',
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};
const captionStyle: React.CSSProperties = {
  width: 12,
  color: 'var(--lf-text-muted)',
  fontWeight: 600,
};
const inputStyle: React.CSSProperties = { width: 74 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-faint)', fontSize: 11 };
