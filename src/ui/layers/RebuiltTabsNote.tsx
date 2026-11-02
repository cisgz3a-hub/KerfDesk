import type { SceneObject } from '../../core/scene';
import { placedTabCount } from '../../core/scene/object-tab-anchors';

/** What a Design Studio rebuild does to tabs placed by hand, said before it is
 *  applied (ADR-494 Amendment 4). Nothing for a part or sketch without any. */
export function RebuiltTabsNote(props: {
  readonly previous: SceneObject | null | undefined;
  readonly movedTabs: number;
  readonly removedTabs: number;
}): JSX.Element | null {
  const { previous, movedTabs, removedTabs } = props;
  if (previous === null || previous === undefined || placedTabCount(previous) === 0) return null;
  return (
    <>
      <p>Placed tabs follow the new size, each on its own edge.</p>
      {movedTabs === 0 ? null : (
        <p role="alert">
          {tabs(movedTabs)} on an outline that changes form and {verb(movedTabs, 'moves', 'move')}{' '}
          to the nearest point of it. Undo restores {movedTabs === 1 ? 'it' : 'them'}.
        </p>
      )}
      {removedTabs === 0 ? null : (
        <p role="alert">
          {tabs(removedTabs)} on a path these dimensions remove and {verb(removedTabs, 'is', 'are')}{' '}
          removed. Undo restores {removedTabs === 1 ? 'it' : 'them'}.
        </p>
      )}
    </>
  );
}

function tabs(count: number): string {
  return count === 1 ? '1 placed tab sits' : `${count} placed tabs sit`;
}

function verb(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
