import {
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  parseListOfComponentValues,
} from '@csstools/css-parser-algorithms';
import { isTokenDelim, isTokenIdent, tokenize } from '@csstools/css-tokenizer';
import { svgOpacityMath } from './svg-opacity-math';
import { hasSvgOpacityVariables } from './svg-opacity-variables';

// SVG paint opacity is an inherited CSS value. Keep validation shared by the
// cascade and the final attribute lookup so invalid winners cannot hide a
// lower valid declaration. Comments separate tokens, never join them.
const NUMBER = /^([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%)?$/;

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
  const number = numericOpacity(normalized);
  if (number !== null) return number;
  // Valid var()/env()/attr() values win before substitution, even if it later
  // fails. Do not expose an older declaration when context is unavailable.
  if (hasSvgOpacityVariables(value)) return 'unresolved';
  return svgOpacityMath(value);
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
  try {
    return paintOpacityDeclaration(raw);
  } catch {
    return null;
  }
}

function paintOpacityDeclaration(
  raw: string,
): { readonly value: string; readonly important: boolean } | null {
  // CSS Syntax 3: the final two non-whitespace component values must be ! and
  // an ident whose decoded value is important. Nested suffixes are not syntax.
  // Slice the original expression so calc's whitespace/comments are unchanged.
  const nodes = parseListOfComponentValues(tokenize({ css: raw })).filter(
    (node) => !isWhiteSpaceOrCommentNode(node),
  );
  const bang = nodes.at(-2);
  const ident = nodes.at(-1);
  const important =
    isTokenNode(bang) &&
    isTokenDelim(bang.value) &&
    bang.value[4].value === '!' &&
    isTokenNode(ident) &&
    isTokenIdent(ident.value) &&
    ident.value[4].value.toLowerCase() === 'important';
  const value = (important ? raw.slice(0, bang.value[2]) : raw).trim();
  return parseSvgPaintOpacity(value) === null ? null : { value, important };
}
