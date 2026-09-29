// BarcodePreviewSvg — the dialog's live preview: the outlines to engrave,
// exactly as laid out, shown as they read on the finished piece. Engraving is
// black on white stock; with Invert, for stock that marks lighter than its
// surface, it is white on black stock. Dark modules therefore always show
// dark on a light quiet zone, and the preview can be scanned from the screen.
// Captions use SVG text as a stand-in for the outlined glyphs placed at
// insert time. The last valid code stays visible, dimmed, while the current
// settings are invalid.

import type { CSSProperties } from 'react';
import { layoutPolylines, type BarcodeLayout } from '../../core/barcode';
import type { Polyline } from '../../core/scene';

/* eslint-disable no-restricted-syntax -- deliberate fixed literals: an
   engraving preview in black and white stays scannable in either theme
   (ADR-047 exception, as BoxPreview). */
const PAPER = '#ffffff';
const INK = '#000000';
const EXTENT = '#9a958e';
/* eslint-enable no-restricted-syntax */

export function BarcodePreviewSvg(props: {
  readonly layout: BarcodeLayout | null;
  readonly stale: boolean;
}): JSX.Element {
  const layout = props.layout;
  if (layout === null) {
    return (
      <div role="img" aria-label="No barcode preview" style={emptyStyle}>
        No preview
      </div>
    );
  }
  const margin = Math.max(layout.widthMm, layout.heightMm) * 0.04;
  const width = layout.widthMm + 2 * margin;
  const height = layout.heightMm + 2 * margin;
  const stock = layout.inverted ? INK : PAPER;
  const engraved = layout.inverted ? PAPER : INK;
  return (
    <svg
      role="img"
      aria-label={`Barcode preview: ${layout.description}`}
      viewBox={`${-margin} ${-margin} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ ...svgStyle, background: stock, opacity: props.stale ? 0.35 : 1 }}
    >
      <rect
        x={0}
        y={0}
        width={layout.widthMm}
        height={layout.heightMm}
        fill="none"
        stroke={EXTENT}
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path d={pathData(layoutPolylines(layout))} fill={engraved} fillRule="evenodd" />
      {layout.captions.map((caption, index) => (
        <text
          key={`${index}-${caption.text}`}
          x={caption.centerXMm}
          y={caption.topMm}
          fontSize={caption.sizeMm}
          textAnchor="middle"
          dominantBaseline="hanging"
          fontFamily="Roboto, var(--lf-font)"
          // Captions are holes in an inverted plate, so they show the stock.
          fill={layout.background ? stock : engraved}
        >
          {caption.text}
        </text>
      ))}
    </svg>
  );
}

function pathData(polylines: readonly Polyline[]): string {
  return polylines
    .map((polyline) =>
      polyline.points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${num(point.x)} ${num(point.y)}`)
        .join('')
        .concat('Z'),
    )
    .join('');
}

function num(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

const svgStyle: CSSProperties = {
  width: '100%',
  height: 200,
  background: PAPER,
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
};

const emptyStyle: CSSProperties = {
  ...svgStyle,
  background: 'var(--lf-bg-input)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--lf-text-muted)',
};
