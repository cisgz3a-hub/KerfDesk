import { useDeferredValue, useMemo } from 'react';
import type { ConstrainedSketch2d } from '../../core/sketch-constraints/constrained-sketch';
import { materializeConstrainedSketch } from '../../core/sketch-constraints/materialize-constrained-sketch';
import { VectorGeometryPreview } from './VectorGeometryPreview';
export function SketchDraftPreview({
  sketch,
}: {
  readonly sketch: ConstrainedSketch2d;
}): JSX.Element {
  const deferred = useDeferredValue(sketch);
  // eslint-disable-next-line no-restricted-syntax -- Materialized vector scene data, not UI chrome.
  const built = useMemo(() => materializeConstrainedSketch(deferred, '#000000'), [deferred]);
  if (built.paths === undefined || built.bounds === undefined)
    return (
      <p className="lf-authoring-hint">
        {built.result.kind === 'invalid'
          ? built.result.reason
          : built.result.status === 'over-constrained'
            ? 'Conflicting relations need attention. Review to see which dimensions disagree.'
            : 'Add a line, outline or circle to see its geometry.'}
      </p>
    );
  return (
    <>
      <VectorGeometryPreview
        paths={built.paths}
        bounds={built.bounds}
        label="Sketch draft preview"
      />
      <p className="lf-authoring-hint">Draft preview. Review the geometry before applying it.</p>
    </>
  );
}
