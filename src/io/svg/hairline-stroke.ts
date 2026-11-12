// PostScript and PDF draw a zero-width stroke as the thinnest line the device
// can show (PostScript Language Reference, 3rd ed., `setlinewidth`; ISO
// 32000-1 §8.4.3.2, Line Width). SVG paints no stroke at width 0 (SVG 2,
// painting.html#StrokeWidth), so the SVG import would drop such an outline.
// The PostScript and PDF converters write a zero, negative or rounded-to-zero
// width as this hairline instead (code quality audit C2, E1-P1-3, E1-P1-4).

export const HAIRLINE_STROKE_WIDTH = '0.001';

/** A formatted stroke width, or the hairline when it would paint nothing. */
export function hairlineSafeStrokeWidth(formatted: string): string {
  return Number(formatted) > 0 ? formatted : HAIRLINE_STROKE_WIDTH;
}
