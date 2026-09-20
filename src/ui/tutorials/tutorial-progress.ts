import { useState } from 'react';

const STORAGE_KEY = 'kerfdesk.visual-tutorials.v1';
type LessonProgress = { readonly step: number; readonly completed: boolean };
export type TutorialProgress = Readonly<Record<string, LessonProgress>>;

export function readTutorialProgress(): TutorialProgress {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(isProgressEntry));
  } catch {
    return {};
  }
}

function isProgressEntry(entry: [string, unknown]): entry is [string, LessonProgress] {
  const [id, value] = entry;
  if (id.length > 80 || typeof value !== 'object' || value === null) return false;
  return (
    'step' in value &&
    typeof value.step === 'number' &&
    Number.isInteger(value.step) &&
    value.step >= 0 &&
    value.step < 50 &&
    'completed' in value &&
    typeof value.completed === 'boolean'
  );
}

export function useTutorialProgress(): {
  readonly progress: TutorialProgress;
  readonly remember: (id: string, step: number, completed?: boolean) => void;
} {
  const [progress, setProgress] = useState(readTutorialProgress);
  const remember = (id: string, step: number, completed = false): void => {
    const next = {
      ...progress,
      [id]: { step, completed: completed || progress[id]?.completed === true },
    };
    setProgress(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* Session learning still works. */
    }
  };
  return { progress, remember };
}
