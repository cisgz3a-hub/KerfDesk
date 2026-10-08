import type { FixtureTemplate } from '../../../core/camera/fixtures/fixture-template';
import type { FixturePlacementPlan } from '../../../core/camera/fixtures/fixture-layout';
import type { DesignFrame } from '../../../core/camera/pieces/piece-placements';

export function FixtureLayoutPreview(props: {
  readonly template: FixtureTemplate;
  readonly plan: FixturePlacementPlan | null;
}): JSX.Element {
  const { bedWidthMm, bedHeightMm } = props.template.basis;
  return (
    <svg
      role="img"
      aria-label="Saved fixture slots and proposed design positions"
      width="100%"
      height={220}
      viewBox={`0 0 ${bedWidthMm} ${bedHeightMm}`}
      style={{ background: 'var(--lf-bg-canvas)', border: '1px solid var(--lf-border)' }}
    >
      {props.template.slots.map((slot, index) => (
        <g key={slot.id}>
          <polygon
            points={slot.piece.outline.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="var(--lf-text-faint)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={slot.piece.rect.centre.x}
            y={slot.piece.rect.centre.y}
            fontSize={Math.max(bedWidthMm, bedHeightMm) / 35}
            textAnchor="middle"
            fill="var(--lf-text)"
          >
            {index + 1}
          </text>
        </g>
      ))}
      {props.plan?.designs.map((design, index) => (
        <polygon
          key={props.plan?.slotIds[index]}
          points={corners(design)}
          fill="var(--lf-accent)"
          fillOpacity={0.2}
          stroke="var(--lf-accent)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
function corners(frame: DesignFrame): string {
  const radians = (frame.turnDeg * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
    .map(([a = 0, b = 0]) => {
      const x = (a * frame.width) / 2,
        y = (b * frame.height) / 2;
      return `${frame.centre.x + x * Math.cos(radians) - y * Math.sin(radians)},${frame.centre.y + x * Math.sin(radians) + y * Math.cos(radians)}`;
    })
    .join(' ');
}
