// BoardAnchorPicker — nine-point placement on the board (ADR-636): a 3x3 grid
// shaped like the board (round for a circle) where each cell moves the
// selected artwork to that corner, edge middle or the centre, the edge margin
// in from the board's edge. One click places; the last choice stays marked.

import { useState } from 'react';
import {
  BOARD_PLACEMENT_ANCHORS,
  boardPlacementAnchorLabel,
  type BoardPlacementAnchor,
} from '../../../core/scene';
import { NumberInput } from '../../kit';

export function BoardAnchorPicker(props: {
  readonly shape: 'rect' | 'circle' | 'polygon';
  readonly canPlace: boolean;
  readonly onPlace: (anchor: BoardPlacementAnchor, marginMm: number) => void;
}): JSX.Element {
  const [margin, setMargin] = useState('5');
  const [last, setLast] = useState<BoardPlacementAnchor | null>(null);
  const marginMm = margin.trim() === '' ? 0 : Number(margin);
  const marginValid = Number.isFinite(marginMm) && marginMm >= 0;
  const disabled = !props.canPlace || !marginValid;
  return (
    <div className="lf-place-board__placement">
      <div
        className="lf-place-board__anchors"
        data-shape={props.shape}
        role="group"
        aria-label="Place artwork on board"
      >
        {BOARD_PLACEMENT_ANCHORS.map((anchor) => {
          const label = boardPlacementAnchorLabel(anchor);
          return (
            <button
              key={anchor}
              type="button"
              className="lf-place-board__anchor"
              aria-label={`Place artwork ${label.toLowerCase()}`}
              aria-pressed={last === anchor}
              data-anchor={anchor}
              disabled={disabled}
              title={
                props.canPlace
                  ? `${label}: move the selected artwork here, ${marginValid ? marginMm : 0} mm in from the edge`
                  : 'Select your artwork first'
              }
              onClick={() => {
                setLast(anchor);
                props.onPlace(anchor, marginMm);
              }}
            />
          );
        })}
      </div>
      <div className="lf-place-board__placement-side">
        <label className="lf-place-board__field">
          Edge margin (mm)
          <NumberInput
            aria-label="Placement edge margin in mm"
            min={0}
            step={0.5}
            value={margin}
            onChange={(event) => setMargin(event.target.value)}
            style={{ width: 76 }}
          />
        </label>
        <p className="lf-place-board__muted">
          {props.canPlace
            ? last === null
              ? 'Choose a spot on the board.'
              : `Placed: ${boardPlacementAnchorLabel(last).toLowerCase()}.`
            : 'Select your artwork on the canvas, then choose a spot.'}
        </p>
        {!marginValid && (
          <p className="lf-place-board__message lf-place-board__message--notice">
            Enter a margin of zero or more millimetres.
          </p>
        )}
      </div>
    </div>
  );
}
