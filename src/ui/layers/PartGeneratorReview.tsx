import type { PreparedPartGenerator } from '../state/prepare-part-generator';
import { VectorGeometryPreview } from './VectorGeometryPreview';
export function PartGeneratorReview(props: {
  readonly prepared: PreparedPartGenerator;
  readonly stale: boolean;
}): JSX.Element {
  const { prepared } = props,
    { object, previousObject } = prepared;
  const bounds = reviewBounds(prepared);
  return (
    <section aria-label="Generated part review">
      {props.stale ? (
        <p role="alert">Artwork or setup changed. Preview the part again before applying.</p>
      ) : null}
      {prepared.geometryMismatch ? (
        <p role="alert">
          Current paths differ from the retained dimensions. Applying this reviewed preview replaces
          those manual geometry edits. Bake the part to keep the current paths as ordinary artwork.
        </p>
      ) : null}
      <VectorGeometryPreview
        paths={object.paths}
        bounds={bounds}
        label="Current and proposed part geometry"
        {...(previousObject === undefined ? {} : { previousPaths: previousObject.paths })}
      />
      <p>
        Proposed: {object.partGenerator.definition.widthMm} ×{' '}
        {object.partGenerator.definition.heightMm} mm, {object.paths.length - 1} holes.{' '}
        {previousObject === undefined
          ? ''
          : 'Solid lines show proposed geometry; dashed lines show current geometry.'}
      </p>
      {previousObject === undefined ? (
        <p>A new named operation will be created with this part.</p>
      ) : (
        <p>
          Artwork placement, scale, operation settings and overrides remain attached. Scale:{' '}
          {object.transform.scaleX} × {object.transform.scaleY}; rotation:{' '}
          {object.transform.rotationDeg}°.
        </p>
      )}
      <p>
        Affected operations:{' '}
        {prepared.operationNames.length === 0
          ? 'No assigned operation'
          : prepared.operationNames.join(', ')}
        .
      </p>
      {prepared.removedPathKeys.length > 0 ? (
        <p>
          {prepared.removedPathKeys.length} removed holes also remove their path-specific bindings
          and holding tabs.
        </p>
      ) : null}
    </section>
  );
}

function reviewBounds({ object, previousObject }: PreparedPartGenerator) {
  const previous = previousObject?.bounds ?? object.bounds;
  return {
    minX: Math.min(object.bounds.minX, previous.minX),
    minY: Math.min(object.bounds.minY, previous.minY),
    maxX: Math.max(object.bounds.maxX, previous.maxX),
    maxY: Math.max(object.bounds.maxY, previous.maxY),
  };
}
