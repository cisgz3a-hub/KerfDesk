import { useState } from 'react';
import type { BooleanCompoundOperand } from '../../core/scene/boolean-compound';
import type { ImportedSvg, Transform } from '../../core/scene';
import {
  boundsForPaths,
  editPathsNodesByDelta,
  pathNodePoint,
} from '../state/path-node-edit-geometry';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { CompoundNumberField } from './CompoundNumberField';

type Props = {
  readonly operand: BooleanCompoundOperand;
  readonly change: (operand: BooleanCompoundOperand) => void;
};
export function BooleanCompoundOperandFields(props: Props): JSX.Element {
  const object = props.operand.object;
  const setTransform = (transform: Transform): void =>
    props.change({ ...props.operand, object: { ...object, transform } });
  return (
    <fieldset>
      <legend>Source geometry</legend>
      <p>
        {props.operand.sourceKind} · original ID: {props.operand.sourceId}. Coordinates here use the
        compound's local frame.
      </p>
      {(['x', 'y', 'scaleX', 'scaleY', 'rotationDeg'] as const).map((key) => (
        <CompoundNumberField
          key={key}
          label={transformLabel(key)}
          kind={key === 'rotationDeg' ? 'angle' : 'length'}
          value={object.transform[key]}
          commit={(value) => setTransform({ ...object.transform, [key]: value })}
        />
      ))}
      {(['mirrorX', 'mirrorY'] as const).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={object.transform[key]}
            title="Mirror this retained source in the compound's local frame."
            onChange={(event) =>
              setTransform({ ...object.transform, [key]: event.currentTarget.checked })
            }
          />
          {key === 'mirrorX' ? 'Mirror source X' : 'Mirror source Y'}
        </label>
      ))}
      <CompoundNodeFields
        key={object.id}
        object={object}
        change={(edited) => props.change({ ...props.operand, object: edited })}
      />
    </fieldset>
  );
}
function transformLabel(key: keyof Transform): string {
  if (key === 'x' || key === 'y') return `Source ${key.toUpperCase()} (mm)`;
  if (key === 'scaleX' || key === 'scaleY') return `Source scale ${key === 'scaleX' ? 'X' : 'Y'}`;
  return 'Source rotation (deg)';
}
function CompoundNodeFields(props: {
  readonly object: ImportedSvg;
  readonly change: (object: ImportedSvg) => void;
}): JSX.Element {
  const [indices, setIndices] = useState({ path: 1, contour: 1, node: 1 });
  const [handle, setHandle] = useState<'anchor' | 'incoming' | 'outgoing'>('anchor');
  const path = props.object.paths[indices.path - 1];
  const ref: PathNodeRef = {
    objectId: props.object.id,
    pathIndex: indices.path - 1,
    polylineIndex: indices.contour - 1,
    pointIndex: indices.node - 1,
    ...(path?.curves === undefined ? {} : { geometry: 'curve' as const }),
    ...(handle === 'anchor' ? {} : { handle }),
  };
  const point =
    handle !== 'anchor' && path?.curves === undefined
      ? null
      : pathNodePoint(props.object.paths, ref);
  const setCoordinate = (axis: 'x' | 'y', value: number): void => {
    if (point === null || point[axis] === value) return;
    const edit = editPathsNodesByDelta(
      props.object.paths,
      [ref],
      axis === 'x' ? value - point.x : 0,
      axis === 'y' ? value - point.y : 0,
    );
    if (edit !== null)
      props.change({ ...props.object, paths: edit.paths, bounds: boundsForPaths(edit.paths) });
  };
  return (
    <fieldset>
      <legend>Source nodes</legend>
      {(['path', 'contour', 'node'] as const).map((key) => (
        <CompoundNumberField
          key={key}
          label={`Source ${key} number`}
          value={indices[key]}
          integer
          commit={(value) => setIndices({ ...indices, [key]: value })}
        />
      ))}
      <label className="lf-field">
        <span>Point</span>
        <select
          className="lf-input"
          aria-label="Source point kind"
          title="Edit an anchor, or the incoming/outgoing control of a canonical curve."
          value={handle}
          onChange={(event) => setHandle(event.currentTarget.value as typeof handle)}
        >
          <option value="anchor">Anchor</option>
          <option value="incoming">Incoming control</option>
          <option value="outgoing">Outgoing control</option>
        </select>
      </label>
      {point === null ? (
        <p role="status">
          This point is unavailable. Choose a path, contour and node that exist; handles require a
          cubic curve.
        </p>
      ) : (
        <>
          {(['x', 'y'] as const).map((axis) => (
            <CompoundNumberField
              key={`${indices.path}-${indices.contour}-${indices.node}-${handle}-${axis}`}
              label={`Source node ${axis.toUpperCase()} (mm)`}
              value={point[axis]}
              commit={(value) => setCoordinate(axis, value)}
            />
          ))}
        </>
      )}
    </fieldset>
  );
}
