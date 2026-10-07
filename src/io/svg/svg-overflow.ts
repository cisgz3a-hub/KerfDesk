export type SvgOverflow = 'visible' | 'hidden' | 'scroll' | 'auto';
const OVERFLOW: ReadonlySet<string> = new Set(['visible', 'hidden', 'scroll', 'auto']);

/** Overflow is not inherited; SVG's UA stylesheet hides nested svg and symbol overflow. */
export function svgOverflow(
  element: Element,
  values: readonly (string | null)[],
  inherited: SvgOverflow,
): SvgOverflow {
  const initial = defaultOverflow(element);
  for (const raw of values) {
    const value = raw
      ?.trim()
      .replace(/\s*!important$/i, '')
      .trim()
      .toLowerCase();
    if (value === 'inherit') return inherited;
    if (value === 'initial' || value === 'unset') return 'visible';
    if (value === 'revert' || value === 'revert-layer') return initial;
    if (isOverflow(value)) return value;
  }
  return initial;
}

function defaultOverflow(element: Element): SvgOverflow {
  const tag = element.tagName.toLowerCase();
  return tag === 'symbol' || (tag === 'svg' && element !== element.ownerDocument.documentElement)
    ? 'hidden'
    : 'visible';
}

function isOverflow(value: string | undefined): value is SvgOverflow {
  return value !== undefined && OVERFLOW.has(value);
}
