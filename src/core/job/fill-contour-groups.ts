import type { Polyline } from '../scene';

/** Each group is one text object's matched contours, interpreted as nonzero.
 * Ungrouped contours retain the base fill rule. Constituents compose even-odd.
 * References belong to the supplied contour array, including island subsets. */
export type NonzeroContourGroups = ReadonlyArray<ReadonlyArray<Polyline>>;

export function nonzeroContourGroupIds(
  groups: NonzeroContourGroups,
): ReadonlyMap<Polyline, number> {
  const ids = new Map<Polyline, number>();
  groups.forEach((group, index) => {
    for (const contour of group) ids.set(contour, index + 1);
  });
  return ids;
}

export function contourGroupsCacheKey(
  contours: ReadonlyArray<Polyline>,
  groups: NonzeroContourGroups,
): string {
  if (groups.length === 0) return '';
  const ids = nonzeroContourGroupIds(groups);
  return contours.map((contour) => ids.get(contour) ?? 0).join(',');
}
