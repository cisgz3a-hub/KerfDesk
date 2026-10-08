import { nestRotation, type NestPlacement, type OutlineNestItem } from '../../core/nesting';
import type { NestingInput, NestLayout } from '../../core/nesting/layout-nest';
export function NestDraftPreview(props: {
  readonly input: NestingInput;
  readonly layout: NestLayout;
}): JSX.Element {
  const { bin, items, obstacles } = props.input;
  const width = bin.maxX - bin.minX,
    height = bin.maxY - bin.minY;
  return (
    <figure style={{ margin: 0 }}>
      <svg
        role="img"
        aria-label="Nesting draft: blue parts and grey locked obstacles"
        viewBox={`${bin.minX} ${bin.minY} ${width} ${height}`}
        style={{
          width: '100%',
          height: 180,
          border: '1px solid var(--lf-border)',
          background: 'var(--lf-bg-canvas)',
        }}
      >
        {(obstacles ?? []).map((rect, index) => (
          <rect
            key={index}
            x={rect.minX}
            y={rect.minY}
            width={rect.maxX - rect.minX}
            height={rect.maxY - rect.minY}
            fill="var(--lf-text-faint)"
            opacity={0.5}
          />
        ))}
        {props.layout.placements.map((placement) => {
          const item = items.find((candidate) => candidate.id === placement.id);
          return item === undefined ? null : (
            <NestPart
              key={placement.id}
              item={item}
              placement={placement}
              usedOutline={props.layout.usedOutline}
              strokeWidth={Math.max(width, height) / 500}
            />
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 12 }}>
        Blue: proposed parts. Grey: locked obstacles. The artwork changes only when accepted.
      </figcaption>
    </figure>
  );
}
function NestPart({
  item,
  placement,
  usedOutline,
  strokeWidth,
}: {
  readonly item: OutlineNestItem;
  readonly placement: NestPlacement;
  readonly usedOutline: boolean;
  readonly strokeWidth: number;
}): JSX.Element {
  const angle = nestRotation(placement);
  const rotate = (x: number, y: number): string => {
    const point: readonly [number, number] =
      angle === 90
        ? [item.height - y, x]
        : angle === 180
          ? [item.width - x, item.height - y]
          : angle === 270
            ? [y, item.width - x]
            : [x, y];
    return `${placement.x + point[0]},${placement.y + point[1]}`;
  };
  return (
    <g
      fill="var(--lf-accent)"
      fillOpacity={0.3}
      stroke="var(--lf-accent)"
      strokeWidth={strokeWidth}
    >
      {usedOutline && item.outline !== undefined ? (
        <path
          fillRule="nonzero"
          d={item.outline
            .map((path) => 'M ' + path.map((point) => rotate(point.x, point.y)).join(' L ') + ' Z')
            .join(' ')}
        />
      ) : (
        <rect
          x={placement.x}
          y={placement.y}
          width={placement.rotated90 ? item.height : item.width}
          height={placement.rotated90 ? item.width : item.height}
        />
      )}
    </g>
  );
}
