import { svgOpacityMath } from './svg-opacity-math';

// SVG paint opacity is an inherited CSS value. Keep validation shared by the
// cascade and the final attribute lookup so invalid winners cannot hide a
// lower valid declaration. Comments separate tokens, never join them.
const NUMBER = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%)?$/;
const IMPORTANT = /!\s*important\s*$/;

export function isSvgPaintOpacityProperty(name: string): boolean {
  return name === 'fill-opacity' || name === 'stroke-opacity';
}

export function svgPaintOpacityText(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseSvgPaintOpacity(
  value: string | null,
): number | 'inherit' | 'initial' | 'revert-layer' | 'unresolved' | null {
  if (value === null) return null;
  const normalized = svgPaintOpacityText(value);
  // All supported declarations are author-origin; revert also rolls back
  // presentation attributes and therefore inherits for these properties.
  if (normalized === 'inherit' || normalized === 'unset' || normalized === 'revert')
    return 'inherit';
  if (normalized === 'initial') return 'initial';
  if (normalized === 'revert-layer') return 'revert-layer';
  return numericOpacity(normalized) ?? svgOpacityMath(value);
}

function numericOpacity(value: string): number | null {
  const match = NUMBER.exec(value);
  if (match === null) return null;
  const amount = Number(match[1]);
  return Math.min(1, Math.max(0, match[2] === '%' ? amount / 100 : amount));
}

// !important is declaration syntax. It is deliberately not accepted by the
// property-value parser above, which also reads raw presentation attributes.
export function svgPaintOpacityDeclaration(
  raw: string,
): { readonly value: string; readonly important: boolean } | null {
  // Locate declaration syntax without rewriting the expression: replacing
  // comments with spaces would make invalid `calc(1/**/+/**/1)` valid.
  const masked = raw
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (comment) => ' '.repeat(comment.length))
    .toLowerCase();
  const match = IMPORTANT.exec(masked);
  const value = (match === null ? raw : raw.slice(0, match.index)).trim();
  return parseSvgPaintOpacity(value) === null ? null : { value, important: match !== null };
}
