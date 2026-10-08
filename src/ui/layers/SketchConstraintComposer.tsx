import { useState } from 'react';
import type { SketchConstraint } from '../../core/sketch-constraints/constrained-sketch';
import type { SketchEditorProps } from './SketchConstraintEditor';
import {
  newSketchConstraint,
  sketchConstraintEntities,
  constraintNeedsPair,
  constraintNeedsDimension,
} from './sketch-constraint-draft';
export function SketchConstraintComposer({ sketch, onChange }: SketchEditorProps): JSX.Element {
  const [kind, setKind] = useState<SketchConstraint['kind']>('distance');
  const [first, setFirst] = useState(''),
    [second, setSecond] = useState(''),
    [value, setValue] = useState('10');
  const entities = sketchConstraintEntities(sketch, kind);
  const firstId = selectedEntity(entities, first, 0),
    secondId = selectedEntity(entities, second, 1);
  const pair = constraintNeedsPair(kind),
    dimension = constraintNeedsDimension(kind);
  return (
    <div>
      <label>
        Constraint type
        <select
          title="Choose the geometric relation to add to this sketch"
          value={kind}
          onChange={(event) => setKind(event.currentTarget.value as SketchConstraint['kind'])}
        >
          {['x', 'y', 'coincident', 'horizontal', 'vertical', 'distance', 'equal', 'diameter'].map(
            (candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ),
          )}
        </select>
      </label>
      <EntityPicker label="First entity" entities={entities} value={firstId} onChange={setFirst} />
      {pair ? (
        <EntityPicker
          label="Second entity"
          entities={entities}
          value={secondId}
          onChange={setSecond}
        />
      ) : null}
      {dimension ? (
        <label>
          New constraint dimension
          <input
            title="Enter a constraint dimension in millimetres or a named parameter"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
      ) : null}
      <button
        title="Add the selected geometric constraint to the retained sketch"
        type="button"
        disabled={firstId === '' || (pair && secondId === '') || sketch.constraints.length >= 128}
        onClick={() =>
          onChange({
            ...sketch,
            constraints: [
              ...sketch.constraints,
              newSketchConstraint(sketch, kind, firstId, secondId, value),
            ],
          })
        }
      >
        Add constraint
      </button>
    </div>
  );
}
function selectedEntity(
  entities: readonly { readonly id: string }[],
  requested: string,
  index: number,
): string {
  return entities.some((entity) => entity.id === requested)
    ? requested
    : (entities[index]?.id ?? entities[0]?.id ?? '');
}
function EntityPicker(props: {
  readonly label: string;
  readonly entities: readonly { readonly id: string }[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <select
        title={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.id}
          </option>
        ))}
      </select>
    </label>
  );
}
