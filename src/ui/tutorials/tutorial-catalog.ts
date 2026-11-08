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

// Learn's search, ranked (UX audit U6-P3-1). It was an unranked substring
// filter in catalogue order: "origin" put the origin lesson 8th of 13, "fill"
// matched "Fillet" and "line" matched "outline", and a laser user got CNC
// lessons first. Now every typed word must start a word somewhere in the
// lesson; a title word outranks a keyword, which outranks the summary or
// location, which outranks step text; a whole word outranks one it only
// starts. Lessons for the other machine kind follow the rest, or are left out
// where `machine` filters them.

type TutorialFields = {
  readonly title: ReadonlyArray<string>;
  readonly keywords: ReadonlyArray<string>;
  readonly summary: ReadonlyArray<string>;
  readonly steps: ReadonlyArray<string>;
};

const FIELD_WEIGHTS: ReadonlyArray<readonly [keyof TutorialFields, number]> = [
  ['title', 100],
  ['keywords', 50],
  ['summary', 20],
  ['steps', 5],
];

export type RankedTutorial = { readonly tutorial: Tutorial; readonly score: number };

export function rankTutorials(
  query: string,
  machine: TutorialMachine,
  options: { readonly otherMachine: 'after' | 'omit' } = { otherMachine: 'after' },
): readonly RankedTutorial[] {
  const words = tokens(query);
  if (words.length === 0) return [];
  const ranked: Array<RankedTutorial & { readonly order: number; readonly other: boolean }> = [];
  TUTORIALS.forEach((tutorial, order) => {
    const other = machine !== 'all' && tutorial.machine !== 'all' && tutorial.machine !== machine;
    if (other && options.otherMachine === 'omit') return;
    const score = scoreTutorial(fieldsOf(tutorial), words);
    // A lesson made for this machine kind wins a tie with a general one.
    const own = tutorial.machine === machine ? 1 : 0;
    if (score !== null) ranked.push({ tutorial, score: score + own, order, other });
  });
  ranked.sort(
    (a, b) => Number(a.other) - Number(b.other) || b.score - a.score || a.order - b.order,
  );
  return ranked.map(({ tutorial, score }) => ({ tutorial, score }));
}

export function searchTutorials(
  query: string,
  category: TutorialCategory | 'All',
  machine: TutorialMachine,
): readonly Tutorial[] {
  return rankTutorials(query, machine)
    .map((ranked) => ranked.tutorial)
    .filter((tutorial) => category === 'All' || tutorial.category === category);
}

function scoreTutorial(fields: TutorialFields, words: ReadonlyArray<string>): number | null {
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const [field, weight] of FIELD_WEIGHTS) {
      for (const candidate of fields[field]) {
        if (candidate === word) best = Math.max(best, weight);
        else if (candidate.startsWith(word)) best = Math.max(best, weight / 2);
      }
    }
    if (best === 0) return null;
    total += best;
  }
  return total;
}

function fieldsOf(tutorial: Tutorial): TutorialFields {
  return {
    title: tokens(tutorial.title),
    keywords: tokens(tutorial.keywords.join(' ')),
    summary: tokens(`${tutorial.summary} ${tutorial.location}`),
    steps: tokens(tutorial.steps.map((step) => `${step.title} ${step.instruction}`).join(' ')),
  };
}

function tokens(text: string): ReadonlyArray<string> {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
