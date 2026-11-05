// Marks a lesson that teaches a Pro tool, where Pro is locked, the way the
// menus mark "Box Generator... (Pro)" and the toolbar marks Design Studio
// (UX audit U6-P3-4).

import { useEdition } from '../licensing/edition';
import { PRO_FEATURES } from '../licensing/pro-features';
import type { Tutorial } from './tutorial-types';

export function TutorialProBadge(props: { readonly tutorial: Tutorial }): JSX.Element | null {
  const locked = !useEdition().pro;
  const feature = props.tutorial.pro;
  if (!locked || feature === undefined) return null;
  return (
    <span
      className="lf-learn-pro-badge"
      title={`${PRO_FEATURES[feature].name} is a Pro tool. KerfDesk Free asks for Pro when you open it.`}
    >
      Pro
    </span>
  );
}

/** In KerfDesk Free, the free lessons come first; the order is otherwise kept. */
export function freeLessonsFirst(
  tutorials: readonly Tutorial[],
  locked: boolean,
): readonly Tutorial[] {
  if (!locked) return tutorials;
  return [...tutorials.filter((t) => t.pro === undefined), ...tutorials.filter((t) => t.pro)];
}
