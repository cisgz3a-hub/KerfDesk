// Job Review wording for laser Line tabs (ADR-494, LBG-C05): how automatic
// tabs are spread round each shape, the share of the cut power that burns
// them, and how many were placed by hand. An operation that never used the
// new settings reads exactly as before ("tabs 4 × 0.5 mm").

import {
  automaticTabLayoutFor,
  tabCutPowerPercentFor,
} from '../../../core/job/operation-cut-extras';
import type { LayerOperationSettings } from '../../../core/scene';
import { formatMm } from './job-review-format';

type TabSettings = Pick<
  LayerOperationSettings,
  | 'tabsEnabled'
  | 'tabSizeMm'
  | 'tabsPerShape'
  | 'tabLayout'
  | 'tabSpacingMm'
  | 'tabMaxPerShape'
  | 'tabCutPowerPercent'
>;

/** "tabs every 50 mm (at most 6) × 0.5 mm, cut at 20%", "tabs 4 × 0.5 mm, 3 placed by hand". */
export function laserTabsPart(settings: TabSettings, placedTabCount = 0): string {
  if (!settings.tabsEnabled) return 'tabs off';
  const percent = tabCutPowerPercentFor(settings);
  return [
    `${automaticTabsText(settings)} × ${formatMm(settings.tabSizeMm)} mm`,
    ...(percent > 0 ? [`cut at ${formatPercent(percent)}%`] : []),
    ...(placedTabCount > 0 ? [`${placedTabCount} placed by hand`] : []),
  ].join(', ');
}

/** The Line group that burns the tab spans, named apart from its cut. */
export function tabSpanGroupLabel(percent: number): string {
  return `Line tabs (${formatPercent(percent)}% of cut power)`;
}

function automaticTabsText(settings: TabSettings): string {
  const layout = automaticTabLayoutFor(settings);
  // The count keeps the stored value, as this line always showed it.
  if (layout.kind === 'count') return `tabs ${settings.tabsPerShape}`;
  const cap = layout.maxPerShape > 0 ? ` (at most ${layout.maxPerShape})` : '';
  return `tabs every ${formatMm(layout.spacingMm)} mm${cap}`;
}

function formatPercent(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
