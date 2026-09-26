// PieceOutlines — the pieces Find pieces found, drawn over the workspace
// camera overlay (ADR-442): each piece's outline, its centre and the line of
// its long side, numbered as in the Camera panel. Pieces left out of the fill
// are drawn faint and dashed. Follows the canvas view through its transform.

import type { DetectedPiece } from '../../../core/camera/pieces/find-pieces';
import type { ViewTransform } from '../../workspace/view-transform';

const CROSS_PX = 6;

export function PieceOutlines(props: {
  readonly pieces: ReadonlyArray<DetectedPiece>;
  readonly excluded: ReadonlySet<number>;
  readonly view: ViewTransform;
  readonly width: number;
  readonly height: number;
}): JSX.Element | null {
  const { pieces, view } = props;
  if (pieces.length === 0) return null;
  const toCanvas = (p: { readonly x: number; readonly y: number }) => ({
    x: view.offsetX + p.x * view.scale,
    y: view.offsetY + p.y * view.scale,
  });
  return (
    <svg
      width={props.width}
      height={props.height}
      viewBox={`0 0 ${props.width} ${props.height}`}
      style={svgStyle}
      data-testid="camera-piece-outlines"
    >
      {pieces.map((piece, index) => {
        const included = !props.excluded.has(index);
        const colour = included ? 'var(--lf-accent)' : 'var(--lf-text-faint)';
        const centre = toCanvas(piece.rect.centre);
        const rad = (piece.rect.axisDeg * Math.PI) / 180;
        const reach = (piece.rect.length / 2) * view.scale;
        return (
          <g key={index} data-included={included}>
            <polygon
              points={piece.outline
                .map(toCanvas)
                .map((p) => `${p.x},${p.y}`)
                .join(' ')}
              fill="none"
              stroke={colour}
              strokeWidth={included ? 2 : 1.5}
              strokeDasharray={included ? undefined : '6 4'}
            />
            <path
              d={`M${centre.x - CROSS_PX},${centre.y}h${2 * CROSS_PX}M${centre.x},${centre.y - CROSS_PX}v${2 * CROSS_PX}`}
              stroke={colour}
              strokeWidth={1.5}
            />
            {piece.shape === 'round' ? null : (
              <line
                x1={centre.x - Math.cos(rad) * reach}
                y1={centre.y - Math.sin(rad) * reach}
                x2={centre.x + Math.cos(rad) * reach}
                y2={centre.y + Math.sin(rad) * reach}
                stroke={colour}
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            )}
            <text x={centre.x + 8} y={centre.y - 8} fill={colour} style={labelStyle}>
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const svgStyle: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'visible' };
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  paintOrder: 'stroke',
  stroke: 'var(--lf-bg-1)',
  strokeWidth: 3,
};
