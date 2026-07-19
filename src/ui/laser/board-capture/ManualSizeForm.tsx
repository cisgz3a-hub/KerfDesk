// ManualSizeForm — the manual-size path of the board-capture panel (ADR-124).
// Once the operator has captured the bottom-left corner (which sets the work
// origin), they can type the board's width and height instead of jogging to the
// other three corners; the outline draws at that size from the captured corner.
// For people who already know their material's exact dimensions.

import { useState } from 'react';
import { Button, NumberInput } from '../../kit';
import { MIN_BOARD_DIMENSION_MM } from './constants';

export function ManualSizeForm({
  disabled,
  onDraw,
}: {
  readonly disabled: boolean;
  readonly onDraw: (widthMm: number, heightMm: number) => void;
}): JSX.Element {
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const width = Number(widthMm);
  const height = Number(heightMm);
  const valid = isValidDimension(widthMm) && isValidDimension(heightMm);
  return (
    <div style={formStyle}>
      <p style={hintStyle}>Or type the board size — bottom-left is the corner you just captured:</p>
      <div style={rowStyle}>
        <NumberInput
          aria-label="Board width in mm"
          value={widthMm}
          disabled={disabled}
          min={MIN_BOARD_DIMENSION_MM}
          step={1}
          style={inputStyle}
          onChange={(event) => setWidthMm(event.target.value)}
        />
        <span aria-hidden>×</span>
        <NumberInput
          aria-label="Board height in mm"
          value={heightMm}
          disabled={disabled}
          min={MIN_BOARD_DIMENSION_MM}
          step={1}
          style={inputStyle}
          onChange={(event) => setHeightMm(event.target.value)}
        />
        <span style={unitStyle}>mm</span>
      </div>
      <Button
        variant="primary"
        disabled={disabled || !valid}
        onClick={() => valid && onDraw(width, height)}
      >
        Draw board at this size
      </Button>
    </div>
  );
}

function isValidDimension(raw: string): boolean {
  const value = Number(raw);
  return raw.trim() !== '' && Number.isFinite(value) && value >= MIN_BOARD_DIMENSION_MM;
}

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid var(--lf-border)',
  paddingTop: 6,
};
const hintStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.3 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const inputStyle: React.CSSProperties = { width: 64 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
