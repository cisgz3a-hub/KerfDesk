import { cncAnchorShiftSince1028 } from '../../core/cnc/cnc-anchor-shift-since-1028';
import type { Project } from '../../core/scene';
import type { OldProjectBurnNotice } from '../../io/project/project-load-metadata';
import { mergedBurnNotices } from '../../io/project/old-project-burn-notice';
import { rotaryFeedChange } from '../../io/project/old-project-rotary-feed';
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
    cncJobOrigin: remembered.cncJobOrigin.length === 0 ? [] : liveCncJobOrigin(project),
    // The rotary as it stands now: switched off or rescaled since the load, it changes.
    rotaryFeed: (remembered.rotaryFeed?.length ?? 0) === 0 ? [] : rotaryFeedChange(project),
  });
  return [...frames, ...burn];
}

// The move as the job stands now: an edit since the load can change it or end it.
function liveCncJobOrigin(project: Project): OldProjectBurnNotice['cncJobOrigin'] {
  const shift = cncAnchorShiftSince1028(project);
  return shift === null ? [] : [{ xMm: shift.x, yMm: shift.y }];
}
