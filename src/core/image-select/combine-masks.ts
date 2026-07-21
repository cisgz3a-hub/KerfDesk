// Selection boolean combining (ADR-242 parity plan PP-B, Top-20 item 5).
//
// Photoshop's four selection modes: Replace, Add (Shift), Subtract (Alt),
// Intersect (Shift+Alt). Alpha-valued per pixel so feathered selections
// combine correctly: add = max, subtract = min(base, 255 - incoming),
// intersect = min. Returns a new mask; inputs are untouched.

import { MASK_SOLID, type SelectionMask } from './selection-mask';

export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

export function combineMasks(
  base: SelectionMask | null,
  incoming: SelectionMask,
  mode: SelectionCombineMode,
): SelectionMask {
  if (base === null || mode === 'replace') return incoming;
  const alpha = new Uint8Array(incoming.alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const a = base.alpha[i] ?? 0;
    const b = incoming.alpha[i] ?? 0;
    alpha[i] = combineByte(a, b, mode);
  }
  return { width: incoming.width, height: incoming.height, alpha };
}

function combineByte(base: number, incoming: number, mode: SelectionCombineMode): number {
  switch (mode) {
    case 'add':
      return Math.max(base, incoming);
    case 'subtract':
      return Math.min(base, MASK_SOLID - incoming);
    case 'intersect':
      return Math.min(base, incoming);
    case 'replace':
      return incoming;
  }
}
