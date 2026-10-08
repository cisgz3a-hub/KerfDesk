import type { SketchSolveResult } from '../../core/sketch-constraints/constrained-sketch';
import type { ConstrainedSketchReview } from '../state/constrained-sketch-actions';
export function SketchSolveReview(props: {
  readonly result: SketchSolveResult | null;
  readonly review: ConstrainedSketchReview | null;
  readonly stale: boolean;
  readonly onApply: () => void;
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
      {review === null ? null : (
        <SketchGeometryPreview review={review} stale={props.stale} onApply={props.onApply} />
      )}
    </>
  );
}
function SketchGeometryPreview(props: {
  readonly review: ConstrainedSketchReview;
  readonly stale: boolean;
  readonly onApply: () => void;
}): JSX.Element {
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
      <svg
        role="img"
        aria-label="Solved sketch outline"
        viewBox={[
          bounds.minX - 2,
          bounds.minY - 2,
          bounds.maxX - bounds.minX + 4,
          bounds.maxY - bounds.minY + 4,
        ].join(' ')}
        width="100%"
        height="160"
      >
        {review.object.paths.flatMap((path, pathIndex) =>
          path.polylines.map((line, lineIndex) => {
            const first = line.points[0];
            const points =
              line.closed && first !== undefined ? [...line.points, first] : line.points;
            return (
              <polyline
                key={pathIndex + '-' + lineIndex}
                points={points.map((point) => point.x + ',' + point.y).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.3"
              />
            );
          }),
        )}
      </svg>
      <button
        title="Apply the current reviewed constraint solution as visible geometry"
        type="button"
        disabled={props.stale}
        onClick={props.onApply}
      >
        Apply reviewed sketch
      </button>
    </section>
  );
}
