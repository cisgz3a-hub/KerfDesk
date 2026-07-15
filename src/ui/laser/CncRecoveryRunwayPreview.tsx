import type { CncContourRunwayPreview } from '../../core/recovery/cnc-contour-runway-preview';

const WIDTH = 560;
const HEIGHT = 260;
const PADDING = 28;

export function CncRecoveryRunwayPreview({
  preview,
}: {
  readonly preview: CncContourRunwayPreview;
}): JSX.Element {
  const projection = projectPoints(preview.recoveryPolyline);
  return (
    <div style={shellStyle}>
      <svg
        data-testid="cnc-recovery-runway-preview"
        role="img"
        aria-label="Proposed CNC recovery runway and uncertainty segment"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={svgStyle}
      >
        <polyline
          points={polylinePoints(preview.recoveryPolyline, projection)}
          fill="none"
          stroke="var(--lf-text-muted)"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <polyline
          points={polylinePoints(preview.runwayPolyline, projection)}
          fill="none"
          stroke="var(--lf-warning)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={projection.x(preview.uncertaintySegment[0].x)}
          y1={projection.y(preview.uncertaintySegment[0].y)}
          x2={projection.x(preview.uncertaintySegment[1].x)}
          y2={projection.y(preview.uncertaintySegment[1].y)}
          stroke="var(--lf-danger)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle
          cx={projection.x(preview.runwayPolyline[0]?.x ?? 0)}
          cy={projection.y(preview.runwayPolyline[0]?.y ?? 0)}
          r="6"
          fill="var(--lf-warning)"
        />
      </svg>
      <div style={legendStyle}>
        <Legend color="var(--lf-warning)" label="Proposed confirmed-clear runway" />
        <Legend color="var(--lf-danger)" label="Selected uncertainty segment" />
        <Legend color="var(--lf-text-muted)" label="Remaining contour" dashed />
      </div>
    </div>
  );
}

function Legend(props: {
  readonly color: string;
  readonly label: string;
  readonly dashed?: boolean;
}): JSX.Element {
  return (
    <span style={legendItemStyle}>
      <span
        aria-hidden="true"
        style={{
          ...swatchStyle,
          background: props.dashed === true ? 'transparent' : props.color,
          borderTop: props.dashed === true ? `2px dashed ${props.color}` : undefined,
        }}
      />
      {props.label}
    </span>
  );
}

function projectPoints(points: CncContourRunwayPreview['recoveryPolyline']): {
  readonly x: (value: number) => number;
  readonly y: (value: number) => number;
} {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);
  const drawnWidth = spanX * scale;
  const drawnHeight = spanY * scale;
  const left = (WIDTH - drawnWidth) / 2;
  const top = (HEIGHT - drawnHeight) / 2;
  return {
    x: (value) => left + (value - minX) * scale,
    y: (value) => top + drawnHeight - (value - minY) * scale,
  };
}

function polylinePoints(
  points: CncContourRunwayPreview['recoveryPolyline'],
  projection: ReturnType<typeof projectPoints>,
): string {
  return points.map(({ x, y }) => `${projection.x(x)},${projection.y(y)}`).join(' ');
}

const shellStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--lf-bg-2)',
};
const svgStyle: React.CSSProperties = { display: 'block', width: '100%', minHeight: 220 };
const legendStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px 16px',
  padding: '8px 12px',
  borderTop: '1px solid var(--lf-border)',
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
const legendItemStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
const swatchStyle: React.CSSProperties = { display: 'inline-block', width: 22, height: 4 };
