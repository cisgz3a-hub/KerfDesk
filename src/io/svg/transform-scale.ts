// linearScaleMagnitude — largest singular value of a 2×2 affine linear part
// [[a, c], [b, d]]: the worst-case distance stretch the transform applies. The
// SVG importer divides its mm chord tolerance by this so curve/arc flattening
// stays 0.25 mm in scene space regardless of the SVG's unit scale or element
// transforms (audit C2). A degenerate (zero / non-finite) transform falls back
// to 1 so the tolerance never becomes infinite or NaN.

export function linearScaleMagnitude(a: number, b: number, c: number, d: number): number {
  const sumSquares = a * a + b * b + c * c + d * d;
  const det = a * d - b * c;
  const disc = Math.sqrt(Math.max(0, sumSquares * sumSquares - 4 * det * det));
  const sigmaMax = Math.sqrt((sumSquares + disc) / 2);
  return Number.isFinite(sigmaMax) && sigmaMax > 0 ? sigmaMax : 1;
}
