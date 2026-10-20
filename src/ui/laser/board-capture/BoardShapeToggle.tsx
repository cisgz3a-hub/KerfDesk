// BoardShapeToggle — pick the captured board's shape (ADR-126, ADR-636):
// Rectangle (four-corner / manual-size capture), Circle (centre + diameter or
// rim points), or Custom shape (three or more corners around an irregular
// board). Switching clears any in-progress capture (the reducer's set-shape).
// Hidden once a board is committed — "Capture a new board" changes shape.

import type { BoardShapeKind } from '../../../core/scene';
import { Icon, type IconName } from '../../kit';

const SHAPES: ReadonlyArray<{
  readonly kind: BoardShapeKind;
  readonly label: string;
  readonly icon: IconName;
  readonly title: string;
}> = [
  {
    kind: 'rect',
    label: 'Rectangle',
    icon: 'square',
    title: 'Capture a rectangular board from its corners, or one corner and its size',
  },
  {
    kind: 'circle',
    label: 'Circle',
    icon: 'circle',
    title: 'Capture a round board from points on its rim, or a marked centre',
  },
  {
    kind: 'polygon',
    label: 'Custom shape',
    icon: 'pentagon',
    title: 'Capture any straight-edged board by jogging to each of its corners in turn',
  },
];

export function BoardShapeToggle({
  shapeKind,
  disabled,
  onChange,
}: {
  readonly shapeKind: BoardShapeKind;
  readonly disabled: boolean;
  readonly onChange: (kind: BoardShapeKind) => void;
}): JSX.Element {
  return (
    <div className="lf-place-board__shapes" role="group" aria-label="Board shape">
      {SHAPES.map(({ kind, label, icon, title }) => (
        <button
          key={kind}
          type="button"
          className="lf-btn lf-place-board__shape"
          disabled={disabled}
          aria-pressed={kind === shapeKind}
          title={title}
          onClick={() => onChange(kind)}
        >
          <Icon name={icon} size={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
