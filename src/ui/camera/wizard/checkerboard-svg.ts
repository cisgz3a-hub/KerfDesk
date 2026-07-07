// Printable checkerboard for the lens-calibration wizard (F-CAM2): an SVG
// sized in real millimetres so it prints at true scale, with a 100 mm scale
// bar to verify the printer didn't shrink it. Pure string builder — the
// SetupStep saves it through the platform file dialog.

import type { CheckerboardSpec } from '../../../core/camera';

const QUIET_ZONE_SQUARES = 1;
const SCALE_BAR_MM = 100;
const CAPTION_BAND_MM = 14;

/** Build the printable board for `spec` (INNER corners) at `squareMm`. */
export function checkerboardSvg(spec: CheckerboardSpec, squareMm: number): string {
  // Inner corners are where four squares meet: 9×6 corners = 10×7 squares.
  const squaresX = spec.cols + 1;
  const squaresY = spec.rows + 1;
  const margin = QUIET_ZONE_SQUARES * squareMm;
  const boardW = squaresX * squareMm;
  const boardH = squaresY * squareMm;
  const widthMm = boardW + 2 * margin;
  const heightMm = boardH + 2 * margin + CAPTION_BAND_MM;

  const squares: string[] = [];
  for (let y = 0; y < squaresY; y += 1) {
    for (let x = 0; x < squaresX; x += 1) {
      if ((x + y) % 2 === 0) continue; // white squares are the paper
      squares.push(
        `<rect x="${margin + x * squareMm}" y="${margin + y * squareMm}" width="${squareMm}" height="${squareMm}" fill="black"/>`,
      );
    }
  }

  const captionY = margin + boardH + 6;
  const barY = captionY + 4;
  const barX = margin;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">`,
    `<rect width="${widthMm}" height="${heightMm}" fill="white"/>`,
    ...squares,
    `<text x="${margin}" y="${captionY}" font-family="sans-serif" font-size="3.5" fill="black">` +
      `${spec.cols}×${spec.rows} inner corners · ${squareMm} mm squares · print at 100% scale, mount flat</text>`,
    // The scale bar: if this doesn't measure 100 mm on paper, the printer
    // scaled the page and the entered square size must be re-measured.
    `<line x1="${barX}" y1="${barY}" x2="${barX + SCALE_BAR_MM}" y2="${barY}" stroke="black" stroke-width="0.4"/>`,
    `<line x1="${barX}" y1="${barY - 1.5}" x2="${barX}" y2="${barY + 1.5}" stroke="black" stroke-width="0.4"/>`,
    `<line x1="${barX + SCALE_BAR_MM}" y1="${barY - 1.5}" x2="${barX + SCALE_BAR_MM}" y2="${barY + 1.5}" stroke="black" stroke-width="0.4"/>`,
    `<text x="${barX + SCALE_BAR_MM + 2}" y="${barY + 1.2}" font-family="sans-serif" font-size="3.5" fill="black">this bar must measure exactly 100 mm</text>`,
    `</svg>`,
  ].join('\n');
}

/** Suggested file name, e.g. checkerboard-9x6-10mm.svg. */
export function checkerboardFileName(spec: CheckerboardSpec, squareMm: number): string {
  return `checkerboard-${spec.cols}x${spec.rows}-${squareMm}mm.svg`;
}
