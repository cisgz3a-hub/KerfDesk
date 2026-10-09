import { useState } from 'react';
import type { SketchEditorProps } from './SketchConstraintEditor';
import { SketchInitialPointEditor } from './SketchInitialPointEditor';
import {
  appendSketchPrimitive,
  removeSketchEntity,
  type SketchPrimitive,
} from './sketch-geometry-draft';
export function SketchGeometryEditor(props: SketchEditorProps): JSX.Element {
  const { sketch, onChange } = props;
  const profiledEdges = new Set(
    sketch.profiles.flatMap((p) =>
      p.pointIds
        .slice(0, p.closed ? undefined : -1)
        .map((point, i) => [point, p.pointIds[(i + 1) % p.pointIds.length]].sort().join(':')),
    ),
  );
  const entities = [
    ...sketch.profiles.map((p) => ({
      kind: 'profile' as const,
      id: p.id,
      label: (p.closed ? 'Closed outline ' : 'Open outline ') + p.id,
    })),
    ...sketch.lines
      .filter((l) => !profiledEdges.has([l.first, l.second].sort().join(':')))
      .map((l) => ({
        kind: 'line' as const,
        id: l.id,
        label: 'Line ' + l.id + ' (' + l.first + ' → ' + l.second + ')',
      })),
    ...sketch.circles.map((c) => ({
      kind: 'circle' as const,
      id: c.id,
      label: 'Circle ' + c.id + ' (centre ' + c.centre + ')',
    })),
  ];
  return (
    <fieldset>
      <legend>Sketch geometry</legend>
      <p className="lf-authoring-hint">
        Add outlines, lines and circles, then use named dimensions and relations to control them.
      </p>
      <ul className="lf-sketch-entities">
        {entities.map((entity) => (
          <li key={entity.kind + entity.id}>
            <span>{entity.label}</span>
            <button
              type="button"
              title={'Remove ' + entity.label + ' and its geometry relations'}
              onClick={() => onChange(removeSketchEntity(sketch, entity.kind, entity.id))}
            >
              Remove {entity.id}
            </button>
          </li>
        ))}
      </ul>
      <PrimitiveComposer {...props} />
      <details>
        <summary title="Edit the starting coordinates used by the solver">
          Initial point coordinates
        </summary>
        <p className="lf-authoring-hint">
          Position constraints override these starting coordinates when solved. Edit the dimension
          or relation to move a constrained point.
        </p>
        <SketchInitialPointEditor {...props} />
      </details>
    </fieldset>
  );
}
function PrimitiveComposer({ sketch, onChange }: SketchEditorProps): JSX.Element {
  const [kind, setKind] = useState<SketchPrimitive>('rectangle');
  const [values, setValues] = useState(['0', '0', '20', '10']);
  const fields =
    kind === 'circle'
      ? ['Centre X (mm)', 'Centre Y (mm)', 'Diameter (mm)']
      : kind === 'line'
        ? ['Start X (mm)', 'Start Y (mm)', 'End X (mm)', 'End Y (mm)']
        : ['X (mm)', 'Y (mm)', 'Width (mm)', 'Height (mm)'];
  const visibleValues = kind === 'circle' ? [...values.slice(0, 3), '0'] : values;
  const parsed = visibleValues.map((value) => (value.trim() === '' ? NaN : Number(value)));
  const next = appendSketchPrimitive(sketch, kind, parsed);
  return (
    <div className="lf-sketch-composer">
      <label>
        Geometry type
        <select
          title="Choose geometry to add"
          value={kind}
          onChange={(e) => setKind(e.currentTarget.value as SketchPrimitive)}
        >
          <option value="rectangle">Rectangle</option>
          <option value="line">Line</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <div className="lf-authoring-dimensions">
        {fields.map((label, i) => (
          <label key={label}>
            {label}
            <input
              title={label}
              type="number"
              step="any"
              value={values[i]}
              onChange={(e) =>
                setValues(values.map((value, j) => (i === j ? e.currentTarget.value : value)))
              }
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        title="Add this geometry to the sketch draft"
        disabled={next === null}
        onClick={() => {
          if (next !== null) onChange(next);
        }}
      >
        Add geometry
      </button>
      {next === null ? (
        <p className="lf-authoring-hint">
          Use valid dimensions within the sketch limits: 32 points, 64 lines, 16 circles and 64
          named dimensions.
        </p>
      ) : null}
    </div>
  );
}
