import type {
  ConstrainedSketch2d,
  NamedSketchParameter,
} from '../../core/sketch-constraints/constrained-sketch';
import type { SketchEditorProps } from './SketchConstraintEditor';
export function SketchParameterEditor({ sketch, onChange }: SketchEditorProps): JSX.Element {
  function patch(index: number, change: Partial<NamedSketchParameter>): void {
    onChange({
      ...sketch,
      parameters: sketch.parameters.map((parameter, i) =>
        i === index ? { ...parameter, ...change } : parameter,
      ),
    });
  }
  return (
    <fieldset>
      <legend>Named dimensions and expressions</legend>
      <p>
        Use named parameters, + − × / and parentheses. Constants in expressions need units, for
        example width/4 + 2mm.
      </p>
      {sketch.parameters.map((parameter, index) => (
        <SketchParameterRow
          key={index}
          parameter={parameter}
          index={index}
          patch={(change) => patch(index, change)}
          remove={() =>
            onChange({ ...sketch, parameters: sketch.parameters.filter((_, i) => i !== index) })
          }
        />
      ))}
      <button
        title="Add a named dimension or expression to this sketch"
        type="button"
        disabled={sketch.parameters.length >= 64}
        onClick={() => onChange(addDimension(sketch))}
      >
        Add dimension
      </button>
    </fieldset>
  );
}
function SketchParameterRow(props: {
  readonly parameter: NamedSketchParameter;
  readonly index: number;
  readonly patch: (change: Partial<NamedSketchParameter>) => void;
  readonly remove: () => void;
}): JSX.Element {
  const { parameter: p, patch } = props;
  return (
    <div className="lf-sketch-parameter-row">
      <label>
        Parameter name
        <input
          title="Name this parameter for use in dimension expressions and constraints"
          aria-label={'Parameter ' + (props.index + 1) + ' name'}
          value={p.name}
          onChange={(event) => patch({ name: event.currentTarget.value })}
        />
      </label>
      <label>
        Value or expression
        <input
          title="Enter a numeric value or an expression using named sketch parameters"
          aria-label={p.name + ' value or expression'}
          value={String(p.value)}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            patch({ value: raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw });
          }}
        />
      </label>
      <label>
        Unit
        <select
          title="Choose millimetres, degrees or a unitless scalar for this parameter"
          aria-label={p.name + ' unit'}
          value={p.unit}
          onChange={(event) =>
            patch({ unit: event.currentTarget.value as NamedSketchParameter['unit'] })
          }
        >
          <option value="mm">mm</option>
          <option value="deg">degrees</option>
          <option value="scalar">scalar</option>
        </select>
      </label>
      <button
        title={'Remove parameter ' + p.name + ' from this sketch'}
        type="button"
        onClick={props.remove}
      >
        Remove {p.name}
      </button>
    </div>
  );
}
function addDimension(sketch: ConstrainedSketch2d): ConstrainedSketch2d {
  let ordinal = 1;
  while (sketch.parameters.some((parameter) => parameter.name === 'dimension_' + ordinal))
    ordinal += 1;
  return {
    ...sketch,
    parameters: [...sketch.parameters, { name: 'dimension_' + ordinal, unit: 'mm', value: 10 }],
  };
}
