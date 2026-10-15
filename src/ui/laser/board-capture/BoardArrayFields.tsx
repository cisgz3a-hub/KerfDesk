import { NumberInput } from '../../kit';
import type { useBoardArrayForm } from './use-board-array-form';

type Form = ReturnType<typeof useBoardArrayForm>;

export function BoardArrayGridFields({ form }: { readonly form: Form }): JSX.Element {
  return (
    <>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Fill the board with as many copies as fit, instead of a fixed rows × cols"
          checked={form.autoFit}
          onChange={(event) => form.setAutoFit(event.target.checked)}
        />
        Fit as many as fit
      </label>
      {!form.autoFit && (
        <div style={rowStyle}>
          <NumberInput
            aria-label="Rows"
            value={form.rows}
            min={1}
            step={1}
            style={inputStyle}
            onChange={(event) => form.setRows(event.target.value)}
          />
          <span aria-hidden>×</span>
          <NumberInput
            aria-label="Columns"
            value={form.cols}
            min={1}
            step={1}
            style={inputStyle}
            onChange={(event) => form.setCols(event.target.value)}
          />
          <span style={mutedStyle}>rows × cols</span>
        </div>
      )}
    </>
  );
}

export function BoardArraySpacingFields({ form }: { readonly form: Form }): JSX.Element {
  return (
    <>
      <div style={rowStyle}>
        <NumberInput
          aria-label="Spacing in mm"
          value={form.spacing}
          min={0}
          step={1}
          style={inputStyle}
          onChange={(event) => form.setSpacing(event.target.value)}
        />
        <span style={mutedStyle}>mm spacing</span>
      </div>
      <label style={checkStyle}>
        <input
          type="checkbox"
          title="Use the same spacing horizontally and vertically"
          checked={form.linkedSpacing}
          onChange={(event) => {
            form.setLinkedSpacing(event.target.checked);
            if (!event.target.checked) form.setSpacingY(form.spacing);
          }}
        />
        Same X / Y spacing
      </label>
      {!form.linkedSpacing && (
        <div style={rowStyle}>
          <NumberInput
            aria-label="Vertical spacing in mm"
            value={form.spacingY}
            min={0}
            step={1}
            style={inputStyle}
            onChange={(event) => form.setSpacingY(event.target.value)}
          />
          <span style={mutedStyle}>mm vertical spacing</span>
        </div>
      )}
      <div style={rowStyle}>
        <NumberInput
          aria-label="Array edge margin in mm"
          value={form.margin}
          min={0}
          step={1}
          style={inputStyle}
          onChange={(event) => form.setMargin(event.target.value)}
        />
        <span style={mutedStyle}>mm edge margin</span>
      </div>
      {form.isCircle && (
        <label style={checkStyle}>
          <input
            type="checkbox"
            title="Pack rows within the circular boundary using each design's rectangular footprint"
            checked={form.circlePacking === 'rows'}
            onChange={(event) => form.setCirclePacking(event.target.checked ? 'rows' : 'square')}
          />
          Use the round boundary
        </label>
      )}
    </>
  );
}

const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const inputStyle: React.CSSProperties = { width: 56 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
