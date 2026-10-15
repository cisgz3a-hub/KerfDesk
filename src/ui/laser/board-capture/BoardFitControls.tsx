import { useState } from 'react';
import { findRegistrationBoxes } from '../../../core/scene';
import {
  fitObjectToBoard,
  fittedArtworkSize,
  type BoardFitOptions,
  type BoardFitPlan,
} from '../../../core/scene/fit-object-to-board';
import { Button, NumberInput } from '../../kit';
import { useStore } from '../../state';

export function BoardFitControls(props: {
  readonly disabled: boolean;
  readonly onFit: (options: BoardFitOptions) => void;
}): JSX.Element {
  const [mode, setMode] = useState<BoardFitOptions['mode']>('fit');
  const [margin, setMargin] = useState('5');
  const options = { mode, marginMm: margin.trim() === '' ? NaN : Number(margin) };
  const plan = useFitPreview(options);
  const invalid =
    !Number.isFinite(options.marginMm) || options.marginMm < 0 || plan?.kind === 'error';
  return (
    <fieldset style={fieldsetStyle}>
      <legend>Artwork fit</legend>
      <label style={labelStyle}>
        Size
        <select
          className="lf-input"
          aria-label="Board artwork fit mode"
          title="Keep the artwork size or scale it to the board margin"
          value={mode}
          onChange={(event) => setMode(event.target.value === 'keep-size' ? 'keep-size' : 'fit')}
        >
          <option value="fit">Fit inside board</option>
          <option value="keep-size">Keep actual size</option>
        </select>
      </label>
      <label style={labelStyle}>
        Edge margin (mm)
        <NumberInput
          aria-label="Board fit edge margin in mm"
          title="Minimum artwork clearance from the board edge"
          min={0}
          step={0.5}
          value={margin}
          onChange={(event) => setMargin(event.target.value)}
          style={{ width: 76 }}
        />
      </label>
      <p role="status" style={hintStyle}>
        {fitSummary(props.disabled, plan)}
      </p>
      <Button
        disabled={props.disabled || invalid}
        onClick={() => props.onFit(options)}
        title={
          mode === 'fit'
            ? 'Fit the artwork inside the chosen edge margin'
            : 'Center the artwork without changing its size'
        }
      >
        {mode === 'fit' ? 'Fit to board' : 'Center at actual size'}
      </Button>
    </fieldset>
  );
}

function useFitPreview(options: BoardFitOptions): BoardFitPlan | null {
  const scene = useStore((s) => s.project.scene);
  const selectedId = useStore((s) => s.selectedObjectId);
  const additionalIds = useStore((s) => s.additionalSelectedIds);
  const boxes = findRegistrationBoxes(scene);
  const board = boxes[0];
  const boxIds = new Set(boxes.map((box) => box.id));
  const ids = [selectedId, ...additionalIds].filter((id) => id !== null && !boxIds.has(id));
  const artwork =
    ids.length === 1 ? scene.objects.find((object) => object.id === ids[0]) : undefined;
  return artwork === undefined || board === undefined
    ? null
    : fitObjectToBoard(artwork, board, options);
}

function fitSummary(disabled: boolean, plan: BoardFitPlan | null): string {
  if (disabled) return 'Select exactly one design to fit to the board.';
  if (plan === null) return 'Preview the artwork size before applying.';
  if (plan.kind === 'error') return plan.message;
  const size = fittedArtworkSize(plan.object);
  const width = size.width.toFixed(1);
  const height = size.height.toFixed(1);
  return `${width} × ${height} mm · ${(plan.scale * 100).toFixed(1)}%${plan.fits ? '' : ' · exceeds the board margin'}`;
}

const fieldsetStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 0,
  margin: 0,
  padding: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 12,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-muted)' };
