// design-cut-type-labels — operator-facing names for the carve kinds, shared
// by the layer rows and the layer settings so the two never disagree.

import type { DesignCutType } from '../../../core/design/layers';

export const DESIGN_CUT_TYPE_LABELS: Readonly<Record<DesignCutType, string>> = {
  'profile-outside': 'Profile — outside',
  'profile-inside': 'Profile — inside',
  'profile-on-path': 'Profile — on path',
  pocket: 'Pocket',
  engrave: 'Engrave',
  'v-carve': 'V-carve',
  drill: 'Drill',
};
