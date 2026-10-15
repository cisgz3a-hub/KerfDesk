import { memo } from 'react';
import type { Bounds } from '../../../core/scene';
import type { BoardArrayPlan } from '../../../core/scene/board-array-plan';

export const BoardArrayPreview = memo(function BoardArrayPreview({
  plan,
  cell,
}: {
  readonly plan: BoardArrayPlan;
  readonly cell: Bounds;
}): JSX.Element | null {
  const bounds = plan.boardBounds;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) return null;
  const pad = Math.max(width, height) * 0.04;
  const stroke = Math.max(width, height) / 180;
  return (
    <svg
      role="img"
      aria-label={`Board layout preview: ${plan.offsets.length} copies`}
      viewBox={`${bounds.minX - pad} ${bounds.minY - pad} ${width + 2 * pad} ${height + 2 * pad}`}
      style={{ width: '100%', height: 128, background: 'var(--lf-bg-canvas)', borderRadius: 4 }}
    >
      <g transform={`translate(0 ${bounds.minY + bounds.maxY}) scale(1 -1)`}>
        <Boundary bounds={bounds} circular={plan.boardCircular} stroke={stroke} />
        <Boundary bounds={plan.usableBounds} circular={plan.circular} stroke={stroke} />
        {plan.offsets.map((offset, index) => (
          <rect
            key={index}
            x={cell.minX + offset.dx}
            y={cell.minY + offset.dy}
            width={cell.maxX - cell.minX}
            height={cell.maxY - cell.minY}
            fill="var(--lf-accent)"
            fillOpacity={0.18}
            stroke="var(--lf-accent)"
            strokeWidth={stroke}
          />
        ))}
      </g>
    </svg>
  );
});

function Boundary({
  bounds,
  circular,
  stroke,
}: {
  readonly bounds: Bounds;
  readonly circular: boolean;
  readonly stroke: number;
}): JSX.Element | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return null;
  return circular ? (
    <ellipse
      cx={(bounds.minX + bounds.maxX) / 2}
      cy={(bounds.minY + bounds.maxY) / 2}
      rx={width / 2}
      ry={height / 2}
      fill="none"
      stroke="var(--lf-text-muted)"
      strokeWidth={stroke}
    />
  ) : (
    <rect
      x={bounds.minX}
      y={bounds.minY}
      width={width}
      height={height}
      fill="none"
      stroke="var(--lf-text-muted)"
      strokeWidth={stroke}
    />
  );
}
