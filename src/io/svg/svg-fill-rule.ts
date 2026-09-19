import type { ColoredPath } from '../../core/scene';

/** Preserve explicit presentation rules without changing legacy imports
 * that never declared a rule. Inheritance includes group and <use> state.
 */
export function inheritedSvgFillRule(
  value: string | null,
  inherited: ColoredPath['fillRule'],
): ColoredPath['fillRule'] {
  const rule = value
    ?.trim()
    .toLowerCase()
    .replace(/\s*!important$/, '')
    .trim();
  if (rule === 'nonzero' || rule === 'evenodd') return rule;
  return inherited;
}
