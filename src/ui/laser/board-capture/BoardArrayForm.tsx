import type { TileLayout } from '../../../core/scene';
import { Button } from '../../kit';
import { BoardArrayGridFields, BoardArraySpacingFields } from './BoardArrayFields';
import { BoardArrayPreview } from './BoardArrayPreview';
import { useBoardArrayForm } from './use-board-array-form';

export function BoardArrayForm({
  disabled,
  onArray,
}: {
  readonly disabled: boolean;
  readonly onArray: (layout: TileLayout) => void;
}): JSX.Element {
  const form = useBoardArrayForm();
  const { plan, cell } = form;
  const noFits = plan?.offsets.length === 0;
  return (
    <div style={formStyle}>
      <p style={hintStyle}>Or fill the board with copies of the selected design:</p>
      <BoardArrayGridFields form={form} />
      <BoardArraySpacingFields form={form} />
      {!form.valid && (
        <p role="status" style={hintStyle}>
          Enter a finite, non-negative spacing and edge margin.
        </p>
      )}
      {plan !== null && cell !== null && (
        <>
          <BoardArrayPreview plan={plan} cell={cell} />
          <p role="status" aria-live="polite" style={hintStyle}>
            {plan.requestedCount === null
              ? `${plan.offsets.length} copies in this layout.`
              : `${plan.offsets.length} fit; ${plan.requestedCount} requested.`}
            {noFits && ' Reduce the artwork size or edge margin.'}
            {plan.limited && ' Layout capped at 100 per axis and 500 copies.'}
          </p>
          <p style={mutedStyle}>Preview shows artwork footprints; artwork keeps its size.</p>
        </>
      )}
      <Button
        variant="primary"
        disabled={disabled || noFits || !form.valid}
        title={
          disabled
            ? 'Select exactly one design to array across the board'
            : 'Tile copies of the design across the board'
        }
        onClick={() => onArray(form.layout)}
      >
        Array on board
      </Button>
    </div>
  );
}

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const mutedStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-muted)', fontSize: 12 };
