// BoardShapeToggle — pick the captured board's shape (ADR-126): Rectangle
// (four-corner / manual-size capture) or Circle (centre + diameter). Sits at the
// top of the Place Board panel's capture phase; switching clears any in-progress
// capture (the reducer's set-shape). Hidden once a board is committed — the
// operator uses "Capture a new board" to change shape.

import type { BoardShapeKind } from '../../../core/scene';
import { Button } from '../../kit';

const SHAPES: ReadonlyArray<{ readonly kind: BoardShapeKind; readonly label: string }> = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'circle', label: 'Circle' },
];

export function BoardShapeToggle({
  shapeKind,
  onChange,
}: {
  readonly shapeKind: BoardShapeKind;
  readonly onChange: (kind: BoardShapeKind) => void;
}): JSX.Element {
  return (
    <div style={rowStyle} role="group" aria-label="Board shape">
      {SHAPES.map(({ kind, label }) => (
        <Button
          key={kind}
          variant={kind === shapeKind ? 'primary' : 'ghost'}
          aria-pressed={kind === shapeKind}
          title={`Capture a ${label.toLowerCase()} board`}
          onClick={() => onChange(kind)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 4 };
