import { useMemo, useState } from 'react';
import { materializeVectorObject, type VectorSceneObject } from '../../core/geometry';
import type { ColoredPath } from '../../core/scene';

/** Display both geometries in one world-coordinate view, without changing the job. */
export function VectorComparisonPreview(props: {
  readonly before: ReadonlyArray<VectorSceneObject>;
  readonly after: ReadonlyArray<VectorSceneObject>;
  readonly label: string;
}): JSX.Element | null {
  const [showBefore, setShowBefore] = useState(true);
  const [showAfter, setShowAfter] = useState(true);
  const original = useMemo(() => previewGeometry(props.before), [props.before]);
  const result = useMemo(() => previewGeometry(props.after), [props.after]);
  const boxes = [original.bounds, result.bounds].filter((box) => box !== null);
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const spanX = Math.max(1, Math.max(...boxes.map((box) => box.maxX)) - minX);
  const spanY = Math.max(1, Math.max(...boxes.map((box) => box.maxY)) - minY);
  const margin = Math.max(spanX, spanY) * 0.08;
  return (
    <div>
      <svg
        role="img"
        aria-label={props.label}
        width="100%"
        height={220}
        viewBox={`${minX - margin} ${minY - margin} ${spanX + margin * 2} ${spanY + margin * 2}`}
        style={{
          display: 'block',
          background: 'var(--lf-bg-canvas)',
          border: '1px solid var(--lf-border)',
          borderRadius: 4,
        }}
      >
        {showBefore ? (
          <path
            data-testid="comparison-original"
            d={original.d}
            fill="none"
            stroke="var(--lf-text-faint)"
            strokeWidth={2}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {showAfter ? (
          <path
            data-testid="comparison-result"
            d={result.d}
            fill="none"
            stroke="var(--lf-accent)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        <label>
          <input
            type="checkbox"
            checked={showBefore}
            title="Show the original geometry as a dashed outline."
            onChange={(event) => setShowBefore(event.currentTarget.checked)}
          />{' '}
          Original (dashed)
        </label>
        <label>
          <input
            type="checkbox"
            checked={showAfter}
            title="Show the proposed geometry as a solid outline."
            onChange={(event) => setShowAfter(event.currentTarget.checked)}
          />{' '}
          Result (solid)
        </label>
      </div>
    </div>
  );
}
function previewGeometry(objects: ReadonlyArray<VectorSceneObject>) {
  const paths = objects.flatMap((object) => materializeVectorObject(object).paths);
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  const d = paths
    .flatMap((path: ColoredPath) => path.polylines)
    .map((polyline) => {
      const first = polyline.points[0];
      if (first === undefined) return '';
      const parts: string[] = [];
      polyline.points.forEach((point, index) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        bounds =
          bounds === null
            ? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
            : {
                minX: Math.min(bounds.minX, point.x),
                minY: Math.min(bounds.minY, point.y),
                maxX: Math.max(bounds.maxX, point.x),
                maxY: Math.max(bounds.maxY, point.y),
              };
        parts.push(`${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`);
      });
      return parts.join('') + (polyline.closed ? 'Z' : '');
    })
    .join('');
  return { d, bounds: bounds as { minX: number; minY: number; maxX: number; maxY: number } | null };
}
