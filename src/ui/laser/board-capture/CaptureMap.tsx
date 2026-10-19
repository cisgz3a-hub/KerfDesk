// CaptureMap — a small live map of a board capture (ADR-636): the points
// captured so far (numbered), the outline they make, and a crosshair where the
// head or positioning light is now. Drawn as the operator stands at the
// machine — front edge at the bottom — whatever the controller's origin corner.

import type { BoardAxisSigns, Vec2 } from '../../../core/scene';

export type CaptureMapOutline = 'points' | 'path' | 'closed' | 'box';

const MIN_EXTENT_MM = 20;
const PADDING = 0.14;

export function CaptureMap(props: {
  readonly points: ReadonlyArray<Vec2>;
  readonly sight: Vec2 | null;
  readonly signs: BoardAxisSigns;
  readonly outline: CaptureMapOutline;
  readonly label: string;
}): JSX.Element {
  // Screen frame: x = operator's right, y = toward the operator (SVG down).
  const toView = (p: Vec2): Vec2 => ({ x: props.signs.x * p.x, y: -props.signs.y * p.y });
  const points = props.points.map(toView);
  const sight = props.sight === null ? null : toView(props.sight);
  const view = viewBox([...points, ...(sight === null ? [] : [sight])]);
  const unit = Math.max(view.width, view.height) / 100;
  return (
    <svg
      className="lf-place-board__map"
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={props.label}
    >
      {points.length === 0 && sight === null && (
        <text
          className="lf-place-board__map-front"
          x={view.x + view.width / 2}
          y={view.y + view.height / 2}
          fontSize={unit * 7}
          textAnchor="middle"
        >
          Captured points appear here
        </text>
      )}
      <Outline points={points} outline={props.outline} />
      {points.map((point, index) => (
        <g key={index}>
          <circle
            className="lf-place-board__map-point"
            cx={point.x}
            cy={point.y}
            r={unit * 2.6}
            strokeWidth={unit * 0.8}
          />
          <text
            className="lf-place-board__map-label"
            x={point.x + unit * 3.4}
            y={point.y - unit * 3}
            fontSize={unit * 8}
          >
            {index + 1}
          </text>
        </g>
      ))}
      {sight !== null && <Sight at={sight} unit={unit} />}
      <text
        className="lf-place-board__map-front"
        x={view.x + view.width / 2}
        y={view.y + view.height - unit * 2}
        fontSize={unit * 6.5}
        textAnchor="middle"
      >
        front
      </text>
    </svg>
  );
}

function Outline(props: {
  readonly points: ReadonlyArray<Vec2>;
  readonly outline: CaptureMapOutline;
}): JSX.Element | null {
  const { points, outline } = props;
  if (outline === 'points' || points.length < 2) return null;
  if (outline === 'box') {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return (
      <rect
        className="lf-place-board__map-outline"
        x={minX}
        y={minY}
        width={Math.max(...xs) - minX}
        height={Math.max(...ys) - minY}
      />
    );
  }
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  return outline === 'closed' && points.length >= 3 ? (
    <path className="lf-place-board__map-outline" d={`${d} Z`} />
  ) : (
    <path className="lf-place-board__map-open" d={d} />
  );
}

function Sight({ at, unit }: { readonly at: Vec2; readonly unit: number }): JSX.Element {
  const arm = unit * 6;
  return (
    <g className="lf-place-board__map-sight" strokeWidth={unit * 0.9} aria-hidden="true">
      <circle cx={at.x} cy={at.y} r={unit * 3.2} />
      <line x1={at.x - arm} y1={at.y} x2={at.x + arm} y2={at.y} />
      <line x1={at.x} y1={at.y - arm} x2={at.x} y2={at.y + arm} />
    </g>
  );
}

function viewBox(points: ReadonlyArray<Vec2>): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  if (points.length === 0) {
    return { x: -MIN_EXTENT_MM / 2, y: -MIN_EXTENT_MM / 2, width: MIN_EXTENT_MM, height: MIN_EXTENT_MM };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(MIN_EXTENT_MM, Math.max(...xs) - Math.min(...xs)) * (1 + 2 * PADDING);
  const height = Math.max(MIN_EXTENT_MM, Math.max(...ys) - Math.min(...ys)) * (1 + 2 * PADDING);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
