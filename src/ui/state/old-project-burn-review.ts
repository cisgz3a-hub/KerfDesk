import type { Project } from '../../core/scene';
import type { OldProjectBurnNotice } from '../../io/project/project-load-metadata';
import { mergedBurnNotices } from '../../io/project/old-project-burn-notice';
import { oldProjectBurnMessages } from './old-project-burn-messages';

// A migrated project no longer records what it was saved by, so Job Review reads
// what the load said. Only objects still in the project count: a new, imported
// or reopened project leaves this behind with no reset of its own, and a deleted
// text stops warning (ADR-682 Amendment 3). Not saved, so a file saved after the
// upgrade and opened again has been told already.
let remembered: OldProjectBurnNotice | undefined;

export function rememberOldProjectBurn(
  notice: OldProjectBurnNotice | undefined,
  keepEarlier: boolean,
): void {
  remembered = keepEarlier ? mergedBurnNotices(remembered, notice) : notice;
}

export function oldProjectBurnReviewWarnings(project: Project): ReadonlyArray<string> {
  if (remembered === undefined) return [];
  const ids = new Set(project.scene.objects.map((object) => object.id));
  const present = <T extends { readonly objectId: string }>(items: ReadonlyArray<T>) =>
    items.filter((item) => ids.has(item.objectId));
  const { frames, burn } = oldProjectBurnMessages({
    repairedFrames: present(remembered.repairedFrames),
    uncertainFrames: present(remembered.uncertainFrames),
    movedRecords: present(remembered.movedRecords),
    imageDose: present(remembered.imageDose),
  });
  return [...frames, ...burn];
}
