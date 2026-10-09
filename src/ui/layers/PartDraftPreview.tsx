import { useDeferredValue, useMemo } from 'react';
import type { PartGeneratorDefinition } from '../../core/parts/part-generator';
import { materializePartGenerator } from '../../core/parts/materialize-part-generator';
import { VectorGeometryPreview } from './VectorGeometryPreview';
export function PartDraftPreview({
  definition,
}: {
  readonly definition: PartGeneratorDefinition;
}): JSX.Element {
  const deferred = useDeferredValue(definition);
  const built = useMemo(() => materializePartGenerator(deferred), [deferred]);
  if (built.kind === 'invalid') return <p className="lf-authoring-hint">{built.reason}</p>;
  return (
    <>
      <VectorGeometryPreview
        paths={built.value.paths}
        bounds={built.value.bounds}
        label="Parametric part draft preview"
      />
      <p className="lf-authoring-hint">
        {definition.widthMm} × {definition.heightMm} mm; {built.value.paths.length - 1} holes.
        Review geometry and operations before applying.
      </p>
    </>
  );
}
