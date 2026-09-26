// HeightAreaOutlines — each height area's rectangle and height drawn over the
// workspace camera overlay (ADR-441 Amendment 2), so the operator sees where
// the picture switches from the material height to an object's own height.
// Follows the canvas view (zoom and pan) through the overlay's transform.

import type { SurfaceHeightArea } from '../../../core/camera/model/height-areas';
import type { ViewTransform } from '../../workspace/view-transform';
import { heightAreaLabel } from './height-area-label';

export function HeightAreaOutlines(props: {
  readonly areas: ReadonlyArray<SurfaceHeightArea>;
  readonly view: ViewTransform;
  readonly width: number;
  readonly height: number;
}): JSX.Element | null {
  const { areas, view } = props;
  if (areas.length === 0) return null;
  return (
    <svg
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      style={svgStyle}
      data-testid="camera-height-areas"
    >
      {areas.map((area, index) => {
        const x = view.offsetX + area.x * view.scale;
        const y = view.offsetY + area.y * view.scale;
        return (
          <g key={area.id}>
            <rect
              x={x}
              y={y}
              width={area.width * view.scale}
              height={area.height * view.scale}
              fill="none"
              stroke="var(--lf-accent)"
              strokeWidth={1.5}
              strokeDasharray="8 4"
            />
            <text x={x + 4} y={y + 14} fill="var(--lf-accent)" style={labelStyle}>
              {heightAreaLabel(index, area.surfaceHeightMm)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const svgStyle: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'visible' };
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  paintOrder: 'stroke',
  stroke: 'var(--lf-bg-1)',
  strokeWidth: 3,
};
