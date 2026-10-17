import { useState } from 'react';
import {
  buildSelectionTransformEdit,
  selectionMetrics,
  sceneObjectHasVisibleLayer,
  type Project,
  type SceneObject,
  type SelectionTransformEdit,
} from '../../../core/scene';
import { NumberInput } from '../../kit';

export function JigSelectionFields(props: {
  readonly project: Project;
  readonly selectedIds: ReadonlySet<string>;
  readonly onCommit: (project: Project) => void;
}): JSX.Element {
  const [preserveAspect, setPreserveAspect] = useState(true);
  const [error, setError] = useState('');
  const objects = props.project.scene.objects.filter(
    (object) =>
      props.selectedIds.has(object.id) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(props.project.scene, object),
  );
  const metrics = selectionMetrics(objects);
  const edit = (value: SelectionTransformEdit): void => {
    const result = buildSelectionTransformEdit(objects, value);
    if (result.kind === 'error') {
      setError('This selection cannot use that size. Keep proportions locked for rotated artwork.');
      return;
    }
    setError('');
    const transforms = new Map(result.transforms.map((item) => [item.id, item.transform]));
    props.onCommit(withTransforms(props.project, transforms));
  };
  if (metrics === null)
    return (
      <p className="lf-jig-muted">Select artwork or an outline on the jig canvas to edit it.</p>
    );
  return (
    <section aria-label="Jig selection properties" className="lf-jig-fields">
      <strong>{metrics.count} selected</strong>
      <div className="lf-jig-pair">
        <JigNumber
          label="X (mm)"
          value={metrics.bbox.minX}
          onCommit={(x) => edit({ kind: 'position', anchor: 'nw', x })}
        />
        <JigNumber
          label="Y (mm)"
          value={metrics.bbox.minY}
          onCommit={(y) => edit({ kind: 'position', anchor: 'nw', y })}
        />
        <JigNumber
          label="Width (mm)"
          value={metrics.width}
          min={0.001}
          onCommit={(width) => edit({ kind: 'resize', anchor: 'c', width, preserveAspect })}
        />
        <JigNumber
          label="Height (mm)"
          value={metrics.height}
          min={0.001}
          onCommit={(height) => edit({ kind: 'resize', anchor: 'c', height, preserveAspect })}
        />
      </div>
      <label>
        <input
          title="Keep width and height proportional when resizing"
          type="checkbox"
          checked={preserveAspect}
          onChange={(event) => setPreserveAspect(event.target.checked)}
        />{' '}
        Keep proportions
      </label>
      {metrics.rotationDeg !== null && (
        <JigNumber
          label="Rotation (degrees)"
          value={metrics.rotationDeg}
          onCommit={(rotationDeg) => edit({ kind: 'rotate', rotationDeg })}
        />
      )}
      {error !== '' && <p role="alert">{error}</p>}
    </section>
  );
}

function withTransforms(
  project: Project,
  transforms: ReadonlyMap<string, SceneObject['transform']>,
): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => {
        const transform = transforms.get(object.id);
        return transform === undefined ? object : { ...object, transform };
      }),
    },
  };
}

function JigNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <NumberInput
        key={props.value}
        aria-label={props.label}
        defaultValue={Number(props.value.toFixed(3))}
        min={props.min}
        step="any"
        onBlur={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (
            Number.isFinite(value) &&
            value !== Number(props.value.toFixed(3)) &&
            (props.min === undefined || value >= props.min)
          )
            props.onCommit(value);
          else event.currentTarget.value = String(Number(props.value.toFixed(3)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
