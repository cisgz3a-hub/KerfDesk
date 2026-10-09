import type {
  ConstrainedSketch2d,
  SketchConstraint,
} from '../../core/sketch-constraints/constrained-sketch';
import { sketchConstraintLabel, sketchConstraintValue } from './sketch-constraint-draft';
import { SketchConstraintComposer } from './SketchConstraintComposer';
export type SketchEditorProps = {
  readonly sketch: ConstrainedSketch2d;
  readonly onChange: (next: ConstrainedSketch2d) => void;
};
export function SketchConstraintEditor(props: SketchEditorProps): JSX.Element {
  return (
    <fieldset>
      <legend>2D constraints</legend>
      {props.sketch.constraints.map((constraint, index) => (
        <SketchConstraintRow key={constraint.id} {...props} constraint={constraint} index={index} />
      ))}
      <SketchConstraintComposer {...props} />
      <p>
        Supported relations are positions, coincidence, horizontal or vertical lines, distance,
        equal line length and circle diameter. Conflicts are shown before geometry changes.
      </p>
    </fieldset>
  );
}
function SketchConstraintRow(
  props: SketchEditorProps & { readonly constraint: SketchConstraint; readonly index: number },
): JSX.Element {
  const { sketch, constraint: c, index, onChange } = props;
  return (
    <div className="lf-sketch-constraint-row">
      <span>
        {c.id}: {sketchConstraintLabel(c)}
      </span>
      {'value' in c ? (
        <label>
          Dimension (mm or parameter)
          <input
            title="Enter a dimension in millimetres or a named sketch parameter"
            aria-label={c.id + ' dimension'}
            value={typeof c.value === 'number' ? String(c.value) : c.value.parameter}
            onChange={(event) =>
              onChange({
                ...sketch,
                constraints: sketch.constraints.map((item, i) =>
                  i === index
                    ? { ...c, value: sketchConstraintValue(event.currentTarget.value) }
                    : item,
                ),
              })
            }
          />
        </label>
      ) : null}
      <button
        title={'Remove constraint ' + c.id + ' from this sketch'}
        type="button"
        onClick={() =>
          onChange({ ...sketch, constraints: sketch.constraints.filter((_, i) => i !== index) })
        }
      >
        Remove {c.id}
      </button>
    </div>
  );
}
