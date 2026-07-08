// BoardPlacementControls — shown after a board is captured (ADR-124). Two ways
// to use the outline: move the selected artwork onto a corner or the centre of
// the board (on-canvas alignment), and jog the head to that point on the real
// board (for eyeballing or a low-power test). The outline is the registration
// box, so alignment reuses the same reference-box machinery.

import {
  bestFitRectangleFromCorners,
  boardMachinePoints,
  findRegistrationBoxes,
  type BoardAnchor,
  type Vec2,
} from '../../../core/scene';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';

const ANCHORS: ReadonlyArray<{ readonly anchor: BoardAnchor; readonly label: string }> = [
  { anchor: 'center', label: 'Center' },
  { anchor: 'bottom-left', label: 'Btm-left' },
  { anchor: 'bottom-right', label: 'Btm-right' },
  { anchor: 'top-left', label: 'Top-left' },
  { anchor: 'top-right', label: 'Top-right' },
];

export function BoardPlacementControls(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly feed: number;
  readonly disabled: boolean;
  readonly onReset: () => void;
}): JSX.Element {
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const alignToBox = useStore((s) => s.alignSelectionToRegistrationBox);
  const jogToPoint = useLaserStore((s) => s.jogToMachinePosition);

  const boxIds = new Set(findRegistrationBoxes(scene).map((b) => b.id));
  const canAlign =
    boxIds.size > 0 &&
    [selectedObjectId, ...additionalSelectedIds].some((id) => id !== null && !boxIds.has(id));
  const points = boardMachinePoints(props.corners);
  const measured = bestFitRectangleFromCorners(props.corners);

  return (
    <div style={columnStyle}>
      {measured !== null && (
        <p style={measuredStyle}>
          Measured: {measured.widthMm.toFixed(1)} × {measured.heightMm.toFixed(1)} mm — check
          against the physical board.
        </p>
      )}
      <p style={hintStyle}>Add your artwork, select it, then place it:</p>
      <AnchorRow label="Place artwork">
        {ANCHORS.map(({ anchor, label }) => (
          <Button
            key={anchor}
            disabled={!canAlign}
            title={
              canAlign ? `Move artwork to the ${label} of the board` : 'Select your artwork first'
            }
            onClick={() => alignToBox(anchor)}
          >
            {label}
          </Button>
        ))}
      </AnchorRow>
      <AnchorRow label="Jog head to">
        {ANCHORS.map(({ anchor, label }) => {
          const point = points?.[anchor];
          return (
            <Button
              key={anchor}
              disabled={props.disabled || point === undefined}
              title={`Move the head to the ${label} of the board`}
              onClick={() =>
                point !== undefined &&
                void jogToPoint(point.x, point.y, props.feed).catch(() => undefined)
              }
            >
              {label}
            </Button>
          );
        })}
      </AnchorRow>
      <Button variant="ghost" onClick={props.onReset}>
        Capture a new board
      </Button>
    </div>
  );
}

function AnchorRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{props.label}:</span>
      {props.children}
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const measuredStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.3,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
};
const labelStyle: React.CSSProperties = { fontWeight: 600, marginRight: 2 };
