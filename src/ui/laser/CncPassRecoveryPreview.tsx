// Pass-progress preview for pass-boundary CNC recovery (ADR-215): every pass
// drawn from the sealed prepared job, colored by what the transport evidence
// proves, with the selected boundary pass highlighted.

import type { Vec2 } from '../../core/scene';
import type { CncPassRecoveryPassOption } from './cnc-pass-recovery-model';

const WIDTH = 560;
const HEIGHT = 260;
const PADDING = 24;

export function CncPassRecoveryPreview(props: {
  readonly passes: ReadonlyArray<CncPassRecoveryPassOption>;
  readonly selected: { readonly groupIndex: number; readonly passIndex: number } | null;
}): JSX.Element {
  const projection = projectPoints(props.passes.flatMap((pass) => pass.xyPoints));
  const selectedPass = props.passes.find(
    (pass) =>
      pass.groupIndex === props.selected?.groupIndex && pass.passIndex === props.selected.passIndex,
  );
  return (
    <div style={shellStyle}>
      <svg
        data-testid="cnc-pass-recovery-preview"
        role="img"
        aria-label="Pass progress and the selected recovery boundary"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={svgStyle}
      >
        {props.passes.map((pass) => (
          <polyline
            key={`${pass.groupIndex}-${pass.passIndex}`}
            points={polylinePoints(pass.xyPoints, projection)}
            fill="none"
            stroke={statusColor(pass.status)}
            strokeWidth={isSelected(pass, props.selected) ? 5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={pass.status === 'pending' ? '5 5' : undefined}
          />
        ))}
        {selectedPass !== undefined && selectedPass.xyPoints[0] !== undefined ? (
          <circle
            cx={projection.x(selectedPass.xyPoints[0].x)}
            cy={projection.y(selectedPass.xyPoints[0].y)}
            r="6"
            fill="var(--lf-warning)"
          />
        ) : null}
      </svg>
      <div style={legendStyle}>
        <Legend color="var(--lf-success)" label="Provably complete" />
        <Legend color="var(--lf-warning)" label="Uncertain — recovery recuts from here" />
        <Legend color="var(--lf-text-muted)" label="Not reached" dashed />
      </div>
    </div>
  );
}

function isSelected(
  pass: CncPassRecoveryPassOption,
  selected: { readonly groupIndex: number; readonly passIndex: number } | null,
): boolean {
  return pass.groupIndex === selected?.groupIndex && pass.passIndex === selected.passIndex;
}

function statusColor(status: CncPassRecoveryPassOption['status']): string {
  if (status === 'proven-complete') return 'var(--lf-success)';
  if (status === 'uncertain') return 'var(--lf-warning)';
  if (status === 'pending') return 'var(--lf-text-muted)';
  return 'var(--lf-warning)';
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

function projectPoints(points: ReadonlyArray<Vec2>): {
  readonly x: (value: number) => number;
  readonly y: (value: number) => number;
} {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = xs.length === 0 ? 0 : Math.min(...xs);
  const maxX = xs.length === 0 ? 1 : Math.max(...xs);
  const minY = ys.length === 0 ? 0 : Math.min(...ys);
  const maxY = ys.length === 0 ? 1 : Math.max(...ys);
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
  points: ReadonlyArray<Vec2>,
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
const svgStyle: React.CSSProperties = { display: 'block', width: '100%', minHeight: 200 };
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
