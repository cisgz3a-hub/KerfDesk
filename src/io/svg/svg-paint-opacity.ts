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

export function parseSvgPaintOpacity(value: string | null): number | 'inherit' | 'initial' | null {
  if (value === null) return null;
  const normalized = svgPaintOpacityText(value);
  // All supported declarations are author-origin; revert also rolls back
  // presentation attributes and therefore inherits for these properties.
  if (normalized === 'inherit' || normalized === 'unset' || normalized === 'revert')
    return 'inherit';
  if (normalized === 'initial') return 'initial';
  const match = NUMBER.exec(normalized);
  if (match === null) return null;
  const amount = Number(match[1]);
  return Math.min(1, Math.max(0, match[2] === '%' ? amount / 100 : amount));
}

// !important is declaration syntax. It is deliberately not accepted by the
// property-value parser above, which also reads raw presentation attributes.
export function svgPaintOpacityDeclaration(
  raw: string,
): { readonly value: string; readonly important: boolean } | null {
  const normalized = svgPaintOpacityText(raw);
  const match = IMPORTANT.exec(normalized);
  const value = match === null ? normalized : normalized.slice(0, match.index).trim();
  return parseSvgPaintOpacity(value) === null ? null : { value, important: match !== null };
}
