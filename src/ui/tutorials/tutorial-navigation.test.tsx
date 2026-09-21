// Keyboard stepping, preserved reading progress, and one-level Escape navigation
// remain available in the simplified tutorial reader.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { findTutorial } from './tutorial-catalog';
import { readTutorialProgress } from './tutorial-progress';
import { useTutorialStore } from './tutorial-store';
import { TutorialButton } from './TutorialButton';
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
    root.render(
      <>
        <TutorialButton {...(id === undefined ? {} : { tutorialId: id })} />
        <TutorialHost />
      </>,
    );
  });
  await act(async () => {
    const opener = element<HTMLButtonElement>('[data-tutorial-id]');
    opener.focus();
    opener.click();
  });
  await settle();
}

async function press(key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    document.activeElement?.dispatchEvent(event);
  });
  await settle();
  return event;
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
  expect(useUiStore.getState().modalDepth).toBe(0);
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
    'walks back through same-session lessons, one level per Escape',
    async () => {
      const from = lesson('first-project');
      const next = lesson(from.related[0] ?? '');
      await openAt(from.id);

      // Integrations can still open another lesson during a session even though
      // the reader no longer presents a separate set of related-lesson buttons.
      await act(async () => useTutorialStore.getState().openTutorial(next.id));
      await settle();
      expect(element('h1.lf-learn-lesson-heading').textContent).toBe(next.title);
      expect(useTutorialStore.getState().trail).toEqual([from.id]);

      await press('Escape');
      expect(element('h1.lf-learn-lesson-heading').textContent).toBe(from.title);
      await press('Escape');
      expect(document.querySelector('.lf-learn-library')).not.toBeNull();
      await press('Escape');
      expect(document.querySelector('.lf-learn')).toBeNull();
      expect(document.activeElement).toBe(element('[data-tutorial-id]'));
    },
    SLOW,
  );

  it(
    'resumes a half-read lesson when it is reopened from its topic',
    async () => {
      const started = lesson('import');
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ [started.id]: { step: 1, completed: false } }),
      );
      await openAt();
      const summary = [...document.querySelectorAll<HTMLElement>('.lf-learn-topic > summary')].find(
        (candidate) => candidate.textContent === started.category,
      );
      if (summary === undefined) throw new Error(`Missing topic ${started.category}`);
      await click(summary);
      const resume = element<HTMLButtonElement>(`button[title="Open tutorial: ${started.title}"]`);

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
      expect(document.activeElement).toBe(element('[data-tutorial-id]'));

      await act(async () => useTutorialStore.getState().openTutorial('origin'));
      await settle();
      expect(element('h1.lf-learn-lesson-heading').textContent).toBe(lesson('origin').title);
      expect(useTutorialStore.getState().trail).toEqual([]);
      expect(element('button[title="Return to the tutorial library"]').textContent).toContain(
        'All tutorials',
      );

      await press('Escape');
      expect(document.querySelector('.lf-learn-library')).not.toBeNull();
      await press('Escape');
      expect(document.querySelector('.lf-learn')).toBeNull();
    },
    SLOW,
  );

  it('returns directly to the library and clears the same-session trail with All tutorials', async () => {
    await openAt('first-project');
    await act(async () => useTutorialStore.getState().openTutorial('import'));
    await settle();
    expect(useTutorialStore.getState().trail).toEqual(['first-project']);
    await click(element('button[title="Return to the tutorial library"]'));
    expect(useTutorialStore.getState()).toMatchObject({
      isOpen: true,
      tutorialId: null,
      trail: [],
    });
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    await press('Escape');
    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.activeElement).toBe(element('[data-tutorial-id]'));
  });

  it('closes directly from a nested lesson when Close is pressed', async () => {
    await openAt('first-project');
    await act(async () => useTutorialStore.getState().openTutorial('import'));
    await settle();
    await click(element('button[title="Close tutorials and return to your work"]'));
    expect(useTutorialStore.getState()).toMatchObject({
      isOpen: false,
      tutorialId: null,
      trail: [],
    });
    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.activeElement).toBe(element('[data-tutorial-id]'));
  });

  it('leaves arrow keys available to text entry and choice controls', async () => {
    await openAt('first-project');
    await press('ArrowRight');
    const current = stepTitle();
    const reader = element('.lf-learn-reader');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    // jsdom does not implement the browser's computed isContentEditable property.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const controls = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
      editable,
    ];
    for (const control of controls) {
      reader.appendChild(control);
      control.focus();
      expect((await press('ArrowRight')).defaultPrevented).toBe(false);
      expect(stepTitle()).toBe(current);
      expect((await press('ArrowLeft')).defaultPrevented).toBe(false);
      expect(stepTitle()).toBe(current);
      control.remove();
    }
    expect(readTutorialProgress()['first-project']).toEqual({ step: 1, completed: false });
  });
});
