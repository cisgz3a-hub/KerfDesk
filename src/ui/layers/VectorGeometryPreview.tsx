import type { Bounds, ColoredPath } from '../../core/scene';
export function VectorGeometryPreview(props: {
  readonly paths: readonly ColoredPath[];
  readonly bounds: Bounds;
  readonly label: string;
  readonly previousPaths?: readonly ColoredPath[];
}): JSX.Element {
  const { bounds } = props;
  const width = Math.max(bounds.maxX - bounds.minX, 1),
    height = Math.max(bounds.maxY - bounds.minY, 1),
    pad = Math.max(width, height) * 0.08;
  return (
    <svg
      className="lf-authoring-preview"
      role="img"
      aria-label={props.label}
      viewBox={[bounds.minX - pad, bounds.minY - pad, width + 2 * pad, height + 2 * pad].join(' ')}
    >
      <g stroke="var(--lf-danger)" strokeDasharray="4 3" opacity={0.55}>
        <PreviewPaths paths={props.previousPaths ?? []} />
      </g>
      <g stroke="var(--lf-accent)">
        <PreviewPaths paths={props.paths} />
      </g>
    </svg>
  );
}
function PreviewPaths({ paths }: { readonly paths: readonly ColoredPath[] }): JSX.Element {
  return (
    <>
      {paths.flatMap((path, pi) =>
        path.polylines.map((line, li) => {
          const first = line.points[0],
            points = line.closed && first !== undefined ? [...line.points, first] : line.points;
          return (
            <polyline
              key={pi + ':' + li}
              points={points.map((p) => p.x + ',' + p.y).join(' ')}
              fill="none"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          );
        }),
      )}
    </>
  );
}
