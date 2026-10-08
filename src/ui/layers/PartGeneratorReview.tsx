import type { ColoredPath } from '../../core/scene/scene-object';
import type { PreparedPartGenerator } from '../state/prepare-part-generator';

export function PartGeneratorReview(props: {
  readonly prepared: PreparedPartGenerator;
  readonly stale: boolean;
}): JSX.Element {
  const { prepared } = props;
  const { object, previousObject } = prepared;
  const width = Math.max(object.bounds.maxX, previousObject?.bounds.maxX ?? 0);
  const height = Math.max(object.bounds.maxY, previousObject?.bounds.maxY ?? 0);
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
      <svg
        role="img"
        aria-label="Current and proposed part geometry"
        viewBox={[-2, -2, width + 4, height + 4].join(' ')}
        style={{ width: '100%', height: 280, border: '1px solid var(--lf-border)' }}
      >
        <g stroke="var(--lf-danger)" strokeDasharray="1 1" opacity={0.45}>
          <PartPaths paths={previousObject?.paths ?? []} />
        </g>
        <g stroke="var(--lf-accent)">
          <PartPaths paths={object.paths} />
        </g>
      </svg>
      <p>
        Proposed: {object.partGenerator.definition.widthMm} ×{' '}
        {object.partGenerator.definition.heightMm} mm, {object.paths.length - 1} holes. Blue shows
        proposed dimensions; dashed red shows current geometry.
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
function PartPaths(props: { readonly paths: readonly ColoredPath[] }): JSX.Element {
  return (
    <>
      {props.paths.flatMap((path, pathIndex) =>
        path.polylines.map((polyline, lineIndex) => {
          const points = polyline.points;
          const first = points[0];
          const closed = polyline.closed && first !== undefined ? [...points, first] : points;
          return (
            <polyline
              key={pathIndex + ':' + lineIndex}
              points={closed.map((point) => point.x + ',' + point.y).join(' ')}
              fill="none"
              strokeWidth={0.4}
            />
          );
        }),
      )}
    </>
  );
}
