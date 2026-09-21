// Where a reader stands in the catalog. The library used to answer this with
// one hard-coded button ("Start your first project") and a count of all 93
// lessons, which said nothing on a second visit and contradicted the filtered
// list beside it. These helpers answer two honest questions instead: what
// should I open now, and how much of the opening path is behind me.

import { TUTORIALS } from './tutorial-catalog';
import type { TutorialProgress } from './tutorial-progress';
import type { Tutorial } from './tutorial-types';

/** The opening path: the Getting started lessons, in catalog order. */
export const STARTER_PATH: readonly Tutorial[] = TUTORIALS.filter(
  (tutorial) => tutorial.category === 'Getting started',
);

export type Resume = {
  readonly tutorial: Tutorial;
  /** True when the reader already opened this lesson and stopped partway. */
  readonly started: boolean;
};

/**
 * The single best lesson to offer next: one already in progress, else the
 * first unfinished step of the opening path. Undefined once the path is done
 * and nothing is half-read — the library then leads with search, not a CTA.
 */
export function resumeLesson(progress: TutorialProgress): Resume | undefined {
  const inProgress = TUTORIALS.find((tutorial) => {
    const entry = progress[tutorial.id];
    return entry !== undefined && !entry.completed && entry.step > 0;
  });
  if (inProgress !== undefined) return { tutorial: inProgress, started: true };
  const nextUnseen = STARTER_PATH.find((tutorial) => progress[tutorial.id]?.completed !== true);
  return nextUnseen === undefined ? undefined : { tutorial: nextUnseen, started: false };
}

export function countCompleted(
  progress: TutorialProgress,
  lessons: readonly Tutorial[] = TUTORIALS,
): number {
  return lessons.filter((tutorial) => progress[tutorial.id]?.completed === true).length;
}
