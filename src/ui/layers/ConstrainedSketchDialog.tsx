import type { ImportedSvg } from '../../core/scene';
import { Dialog } from '../kit';
import { SketchParameterEditor } from './SketchParameterEditor';
import { SketchConstraintEditor } from './SketchConstraintEditor';
import { SketchInitialPointEditor } from './SketchInitialPointEditor';
import { SketchSolveReview } from './SketchSolveReview';
import { useConstrainedSketchDraft } from './use-constrained-sketch-draft';
export function ConstrainedSketchDialog(props: {
  readonly object: ImportedSvg | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  const draft = useConstrainedSketchDraft(props.object, props.onClose);
  return (
    <Dialog title="Constrained 2D sketch" size="lg" onClose={props.onClose}>
      <p>
        Named dimensions produce ordinary editable vectors. Review each solve before replacing
        geometry. This is a bounded local 2D solver.
      </p>
      <label>
        Sketch name
        <input
          title="Name this constrained sketch"
          value={draft.sketch.name}
          onChange={(event) => draft.change({ ...draft.sketch, name: event.currentTarget.value })}
        />
      </label>
      <SketchParameterEditor sketch={draft.sketch} onChange={draft.change} />
      <details>
        <summary title="Edit the geometric relations used to solve this sketch">
          Constraint relations
        </summary>
        <SketchConstraintEditor sketch={draft.sketch} onChange={draft.change} />
      </details>
      <details>
        <summary title="Edit starting point coordinates in millimetres">
          Initial point coordinates
        </summary>
        <SketchInitialPointEditor sketch={draft.sketch} onChange={draft.change} />
      </details>
      <button
        title="Solve the current constraints and review the resulting geometry"
        type="button"
        onClick={draft.solve}
      >
        Review solved geometry
      </button>
      <SketchSolveReview
        result={draft.result}
        review={draft.review}
        stale={draft.stale}
        onApply={draft.apply}
      />
      {draft.error ? <p role="alert">{draft.error}</p> : null}
      {props.object === undefined ? null : (
        <button
          title="Keep the current visible vectors and remove their retained constraints"
          type="button"
          onClick={draft.bake}
        >
          Bake current visible vectors and remove constraints
        </button>
      )}
      <button
        title="Close the sketch editor without applying an unreviewed solution"
        type="button"
        onClick={props.onClose}
      >
        Cancel
      </button>
    </Dialog>
  );
}
