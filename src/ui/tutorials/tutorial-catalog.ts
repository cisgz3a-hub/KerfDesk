import { DESIGN_TUTORIALS } from './design-tutorials';
import { MACHINE_TUTORIALS } from './machine-tutorials';
import { PRODUCTION_TUTORIALS } from './production-tutorials';
import type { Tutorial, TutorialCategory, TutorialMachine } from './tutorial-types';

export const TUTORIALS: readonly Tutorial[] = [
  ...DESIGN_TUTORIALS,
  ...MACHINE_TUTORIALS,
  ...PRODUCTION_TUTORIALS,
];

export function findTutorial(id: string | null): Tutorial | undefined {
  return TUTORIALS.find((tutorial) => tutorial.id === id);
}

export function searchTutorials(
  query: string,
  category: TutorialCategory | 'All',
  machine: TutorialMachine,
): readonly Tutorial[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return TUTORIALS.filter((tutorial) => {
    if (category !== 'All' && tutorial.category !== category) return false;
    if (machine !== 'all' && tutorial.machine !== 'all' && tutorial.machine !== machine)
      return false;
    const text = [
      tutorial.title,
      tutorial.summary,
      tutorial.location,
      ...tutorial.keywords,
      ...tutorial.steps.map((step) => `${step.title} ${step.instruction}`),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
