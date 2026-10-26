// ADR-497 Amendment 1: a Material Test cell keeps its generated place in the
// burn order. A row lists its cells lowest risk first (decision 3), and the
// compiler keeps that order. The cut planner would re-plan one operation's
// Line groups by distance from the head, so on a right-side or centre origin,
// or under a right-to-left Cut direction, a Cut grid would cut each row's
// hottest cell first. Each cell is planned in its own scope instead.

import type { SceneObject } from '../scene';

export const MATERIAL_TEST_CELL_SOURCE = 'material-test-grid';

/** True when every object is a generated Material Test cell. */
export function allMaterialTestCells(objects: ReadonlyArray<SceneObject>): boolean {
  return (
    objects.length > 0 &&
    objects.every(
      (object) => object.kind === 'imported-svg' && object.source === MATERIAL_TEST_CELL_SOURCE,
    )
  );
}
