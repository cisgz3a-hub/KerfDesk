import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Icon } from '../kit';
import { evaluateNumericEntry } from '../../core/numeric-expression';
import { useStore } from '../state';
import {
  nodeScenePoint,
  type NodeAxis,
  type NodeAlignment,
} from '../state/path-node-coordinate-actions';
import type { PathNodeRef } from '../state/path-node-edit-actions';

export function NodeCoordinateControls(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const ref = useStore((state) => state.selectedPathNode);
  const refs = useStore((state) => state.selectedPathNodes);
  const object = project.scene.objects.find((entry) => entry.id === ref?.objectId);
  useEffect(() => close(), [close, epoch, object?.id]);
  if (ref === null || (object !== undefined && isBooleanCompoundObject(object))) return null;
  const point = nodeScenePoint(object, ref);
  if (point === null) return null;
  const anchors = refs.filter((entry) => entry.handle === undefined).length;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="lf-btn lf-iconbtn"
        aria-label="Node coordinates"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Edit node coordinates with arithmetic and units, or align selected nodes."
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="sliders" size={16} />
      </button>
      {open ? (
        <AnchoredPopover
          id={panelId}
          label="Node coordinates"
          role="dialog"
          anchorRef={anchorRef}
          initialFocus="input"
          onClose={close}
          onKeyDownCapture={(event) => {
            // Retain native Tab movement between numeric fields instead of
            // this nonmodal popover's usual single-control close-on-Tab.
            if (event.key === 'Tab') event.stopPropagation();
          }}
        >
          <NodeCoordinateValues refValue={ref} point={point} anchors={anchors} />
        </AnchoredPopover>
      ) : null}
    </>
  );
}
function NodeCoordinateValues({
  refValue,
  point,
  anchors,
}: {
  readonly refValue: PathNodeRef;
  readonly point: { readonly x: number; readonly y: number };
  readonly anchors: number;
}): JSX.Element {
  const setCoordinate = useStore((state) => state.setSelectedPathNodeCoordinate);
  const align = useStore((state) => state.alignSelectedPathNodes);
  return (
    <section aria-label="Node coordinate values" className="lf-node-coordinate-panel">
      <strong>{refValue.handle === undefined ? 'Node' : 'Curve handle'} · mm</strong>
      {(['x', 'y'] as const).map((axis) => (
        <CoordinateInput
          key={`${referenceKey(refValue)}-${axis}`}
          axis={axis}
          value={point[axis]}
          commit={(value) => setCoordinate(axis, value)}
        />
      ))}
      {anchors > 1 ? (
        <div aria-label="Align selected nodes">
          {(['x', 'y'] as const).map((axis) => (
            <div key={axis} className="lf-node-align-row">
              <span>Align {axis.toUpperCase()}</span>
              {(['min', 'center', 'max'] as const).map((position) => (
                <button
                  key={position}
                  type="button"
                  className="lf-btn"
                  aria-label={`Align nodes ${axis.toUpperCase()} ${position}`}
                  title={`Align selected anchors to their ${alignmentWord(position)} ${axis.toUpperCase()} coordinate. One undo step.`}
                  onClick={() => align(axis, position)}
                >
                  {position === 'center' ? 'Mid' : position === 'min' ? 'Min' : 'Max'}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
function CoordinateInput(props: {
  readonly axis: NodeAxis;
  readonly value: number;
  readonly commit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<{ readonly text: string; readonly base: number } | null>(null);
  const shown = Number(props.value.toFixed(3)).toString();
  const text = draft !== null && draft.base === props.value ? draft.text : shown;
  const result = evaluateNumericEntry(text, { kind: 'length' });
  const commit = (): void => {
    if (draft !== null && draft.base === props.value && result.kind === 'ok' && text !== shown)
      props.commit(result.value);
    setDraft(null);
  };
  return (
    <label className="lf-node-coordinate-field">
      <span>{props.axis.toUpperCase()}</span>
      <input
        type="text"
        inputMode="decimal"
        className="lf-input"
        aria-label={`Node ${props.axis.toUpperCase()} coordinate`}
        title="Workspace coordinate in mm. Type arithmetic or units such as 1in; Enter or blur applies. Moves all selected nodes by the same distance."
        value={text}
        aria-invalid={result.kind !== 'ok'}
        onChange={(event) => setDraft({ text: event.currentTarget.value, base: props.value })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit();
          }
          if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
    </label>
  );
}
function referenceKey(ref: PathNodeRef): string {
  return `${ref.objectId}-${ref.pathIndex}-${ref.polylineIndex}-${ref.pointIndex}-${ref.handle ?? 'anchor'}`;
}
function alignmentWord(value: NodeAlignment): string {
  return value === 'center' ? 'bounding midpoint' : value === 'min' ? 'minimum' : 'maximum';
}
