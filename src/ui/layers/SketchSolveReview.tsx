import { VectorGeometryPreview } from './VectorGeometryPreview';
import type { SketchSolveResult } from '../../core/sketch-constraints/constrained-sketch';
import type { ConstrainedSketchReview } from '../state/constrained-sketch-actions';
export function SketchSolveReview(props: {
  readonly result: SketchSolveResult | null;
  readonly review: ConstrainedSketchReview | null;
  readonly stale: boolean;
}): JSX.Element {
  const { result, review } = props;
  return (
    <>
      {result?.kind === 'solved' ? (
        <div role="status">
          <p>
            {result.status}; {result.degreesOfFreedom} degrees of freedom; maximum residual{' '}
            {result.maximumResidualMm.toPrecision(4)} mm; {result.redundantEquations} redundant
            equations.
          </p>
          {result.conflicts.map((conflict) => (
            <p key={conflict.constraintId}>
              {conflict.constraintId}: residual {conflict.residualMm.toPrecision(4)} mm
            </p>
          ))}
        </div>
      ) : null}
      {props.stale ? (
        <p role="alert">The project changed. Review the current sketch again.</p>
      ) : null}
      {review === null ? null : <SketchGeometryPreview review={review} />}
    </>
  );
}
function SketchGeometryPreview(props: { readonly review: ConstrainedSketchReview }): JSX.Element {
  const { review } = props,
    bounds = review.object.bounds;
  return (
    <section aria-label="Solved sketch preview">
      <p>
        Size {(bounds.maxX - bounds.minX).toFixed(3)} × {(bounds.maxY - bounds.minY).toFixed(3)} mm.{' '}
        {review.affectedOperationIds.length} bound operations retain their assignments.
      </p>
      {review.replacesManualGeometry ? (
        <p role="alert">
          The visible geometry has manual edits. Applying this reviewed source replaces those edits;
          Undo restores them.
        </p>
      ) : null}
      <VectorGeometryPreview
        paths={review.object.paths}
        bounds={bounds}
        label="Solved sketch outline"
      />
    </section>
  );
}
