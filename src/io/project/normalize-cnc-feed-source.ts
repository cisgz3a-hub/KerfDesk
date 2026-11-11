import { isChiploadMaterialKey } from '../../core/cnc';
import type { CncLayerSettings } from '../../core/scene';
import { isRecord } from '../../core/util/is-record';
import { isPositiveInteger } from '../../core/util/finite';

type CncFeedSource = NonNullable<CncLayerSettings['feedSource']>;

export function normalizeCncFeedSource(
  value: unknown,
  materialKey: unknown,
): CncFeedSource | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value['kind'] === 'machine-starter' &&
    typeof value['starterId'] === 'string' &&
    value['starterId'].trim().length > 0 &&
    isPositiveInteger(value['revision'])
  ) {
    return {
      kind: 'machine-starter',
      starterId: value['starterId'],
      revision: value['revision'],
    };
  }
  if (
    value['kind'] === 'material-recipe' &&
    isChiploadMaterialKey(value['materialKey']) &&
    value['materialKey'] === materialKey &&
    isPositiveInteger(value['fluteCount'])
  ) {
    return {
      kind: 'material-recipe',
      materialKey: value['materialKey'],
      fluteCount: value['fluteCount'],
    };
  }
  return undefined;
}
