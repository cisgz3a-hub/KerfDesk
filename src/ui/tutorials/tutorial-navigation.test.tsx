// Navigating the catalog: stepping with the keyboard, and walking back out of
// lessons reached through "Learn next". Before this, arrows did nothing and
// Escape threw away the whole session from any depth, so a reader who
// followed one suggestion had no way back but the mouse.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { findTutorial } from './tutorial-catalog';
import { readTutorialProgress } from './tutorial-progress';
import { useTutorialStore } from './tutorial-store';
import { TutorialHost } from './TutorialHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'kerfdesk.visual-tutorials.v1';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (result === null) throw new Error(`Missing tutorial control: ${selector}`);
  return result;
}

function lesson(id: string): NonNullable<ReturnType<typeof findTutorial>> {
  const result = findTutorial(id);
  if (result === undefined) throw new Error(`Missing lesson: ${id}`);
  return result;
}

function stepTitle(): string {
  return element('.lf-learn-step-detail h2').textContent ?? '';
}

async function settle(): Promise<void> {
  await act(async () => {
    await import('./TutorialCentre');
  });
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

async function openAt(id?: string): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<TutorialHost />);
  });
  await act(async () => {
    useTutorialStore.getState().openTutorial(id);
  });
  await settle();
}

async function press(key: string): Promise<void> {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

async function click(control: HTMLElement): Promise<void> {
  await act(async () => {
    control.focus();
    control.click();
  });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  useUiStore.setState({ modalDepth: 0 });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('walking the catalog', () => {
  // The lazy reader's first jsdom render costs seconds; not a latency budget.
  const SLOW = 30_000;
  it(
    'steps a lesson with the arrow keys and remembers where it stopped',
    async () => {
      const tutorial = lesson('first-project');
      await openAt(tutorial.id);
      expect(stepTitle()).toBe(tutorial.steps[0]?.title);

      await press('ArrowRight');
      expect(stepTitle()).toBe(tutorial.steps[1]?.title);
      await press('ArrowRight');
      expect(stepTitle()).toBe(tutorial.steps[2]?.title);
      await press('ArrowLeft');
      expect(stepTitle()).toBe(tutorial.steps[1]?.title);
      expect(readTutorialProgress()[tutorial.id]).toEqual({ step: 1, completed: false });

      // The ends hold; arrows never wrap past the first or last step.
      await press('ArrowLeft');
      await press('ArrowLeft');
      expect(stepTitle()).toBe(tutorial.steps[0]?.title);
      for (let index = 0; index < tutorial.steps.length + 2; index += 1) await press('ArrowRight');
      expect(stepTitle()).toBe(tutorial.steps.at(-1)?.title);
    },
    SLOW,
  );

  it(
    'walks back out of a lesson opened from "Learn next", one level per Escape',
    async () => {
      const from = lesson('first-project');
      const next = lesson(from.related[0] ?? '');
      await openAt(from.id);

      await click(
        element<HTMLButtonElement>(`button[title="Open related tutorial: ${next.title}"]`),
      );
      expect(element('.lf-learn-lesson-heading h1').textContent).toBe(next.title);
      // The back control names where it actually returns to, not just "library".
      expect(element('.lf-learn-reader-top button').textContent).toContain(from.title);

      await press('Escape');
      expect(element('.lf-learn-lesson-heading h1').textContent).toBe(from.title);
      await press('Escape');
      expect(document.querySelector('.lf-learn-library')).not.toBeNull();
      await press('Escape');
      expect(document.querySelector('.lf-learn')).toBeNull();
    },
    SLOW,
  );

  it(
    'offers the half-read lesson as the library’s next action',
    async () => {
      const started = lesson('import');
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ [started.id]: { step: 1, completed: false } }),
      );
      await openAt();
      const resume = element<HTMLButtonElement>(
        `button[title="Open the lesson: ${started.title}"]`,
      );
      expect(resume.textContent).toContain('Continue');

      await click(resume);
      // Resuming lands on the saved step, not back at step one.
      expect(stepTitle()).toBe(started.steps[1]?.title);
    },
    SLOW,
  );

  it(
    'starts fresh when a different contextual lesson opens after Close',
    async () => {
      await openAt('first-project');
      await click(element<HTMLButtonElement>('button[aria-label="Close tutorials"]'));
      expect(document.querySelector('.lf-learn')).toBeNull();

      await act(async () => useTutorialStore.getState().openTutorial('origin'));
      await settle();
      expect(element('.lf-learn-lesson-heading h1').textContent).toBe(lesson('origin').title);
      expect(element('.lf-learn-reader-top button').textContent).toContain('All tutorials');

      await press('Escape');
      expect(document.querySelector('.lf-learn-library')).not.toBeNull();
      await press('Escape');
      expect(document.querySelector('.lf-learn')).toBeNull();
    },
    SLOW,
  );
});
