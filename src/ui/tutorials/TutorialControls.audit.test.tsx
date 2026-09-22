import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { TUTORIALS } from './tutorial-catalog';
import { readTutorialProgress } from './tutorial-progress';
import { useTutorialStore } from './tutorial-store';
import type { Tutorial } from './tutorial-types';
import { TutorialButton } from './TutorialButton';
import { TutorialHost } from './TutorialHost';
import { TutorialLibrary } from './TutorialLibrary';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  resetStore();
  useUiStore.setState({ modalDepth: 0 });
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(useUiStore.getState().modalDepth).toBe(0);
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  localStorage.clear();
  vi.unstubAllGlobals();
});

function element<T extends HTMLElement>(selector: string, scope: ParentNode = document): T {
  const result = scope.querySelector<T>(selector);
  if (result === null) throw new Error(`Missing tutorial control: ${selector}`);
  return result;
}

function titleButton(title: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.title === title,
  );
  if (button === undefined) throw new Error(`Missing tutorial button ${title}`);
  return button;
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.focus();
    button.click();
    await import('./TutorialCentre');
  });
}

async function openLibrary(): Promise<void> {
  await act(async () => {
    root.render(<TutorialHost />);
    useTutorialStore.getState().openTutorial();
    await import('./TutorialCentre');
  });
}

async function expandTopic(category: string): Promise<HTMLDetailsElement> {
  const section = [...document.querySelectorAll<HTMLDetailsElement>('.lf-learn-topic')].find(
    (candidate) => candidate.querySelector('summary')?.textContent === category,
  );
  if (section === undefined) throw new Error(`Missing tutorial topic ${category}`);
  if (!section.open) await click(element('summary', section));
  return section;
}

function expectStep(tutorial: Tutorial, index: number): void {
  const step = tutorial.steps[index];
  if (step === undefined) throw new Error(`Missing step ${index} in ${tutorial.id}`);
  expect(element('h1.lf-learn-lesson-heading').textContent).toBe(tutorial.title);
  expect(element('.lf-learn-step-detail h2').textContent).toBe(step.title);
  expect(element('.lf-learn-instruction').textContent).toBe(step.instruction);
  expect(element('.lf-learn-result').textContent).toContain(step.result);
  expect(element('.lf-learn-step-count').textContent).toBe(
    `Step ${index + 1} of ${tutorial.steps.length}`,
  );
  const diagram = document.querySelector('.lf-learn-example svg');
  if (diagram !== null) {
    expect(diagram.querySelector('title')?.textContent).toBe(step.focus);
    const phase = step.examplePhase ?? Math.min(index, 2);
    expect(diagram.querySelector('desc')?.textContent).toContain(
      `${['Before', 'Action', 'Result'][phase]} stage`,
    );
  }
}

describe('individual tutorial control outcomes', () => {
  it.each(TUTORIALS)(
    '$id opens from search and context, reads every step, and completes without editing the project',
    async (tutorial) => {
      const before = useStore.getState();
      const tool = useUiStore.getState().toolMode;
      await act(async () =>
        root.render(
          <TutorialLibrary
            query={tutorial.title}
            setQuery={vi.fn()}
            topic={null}
            setTopic={vi.fn()}
          />,
        ),
      );
      await click(titleButton(`Open tutorial: ${tutorial.title}`));
      expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: tutorial.id });
      await act(async () => {
        useTutorialStore.getState().closeTutorial();
        root.render(
          <>
            <TutorialButton tutorialId={tutorial.id} />
            <TutorialHost />
          </>,
        );
      });
      const contextual = element<HTMLButtonElement>('[data-tutorial-id]', host);
      await click(contextual);
      expectStep(tutorial, 0);
      expect(titleButton('Read the previous step').disabled).toBe(true);

      for (let index = 1; index < tutorial.steps.length; index += 1) {
        await click(titleButton('Read the next step'));
        expectStep(tutorial, index);
      }
      for (let index = tutorial.steps.length - 2; index >= 0; index -= 1) {
        await click(titleButton('Read the previous step'));
        expectStep(tutorial, index);
      }
      for (let index = 1; index < tutorial.steps.length; index += 1) {
        await click(titleButton('Read the next step'));
      }
      await click(titleButton('Finish tutorial and return to your work'));
      expect(document.querySelector('.lf-learn')).toBeNull();
      expect(document.activeElement).toBe(contextual);
      expect(readTutorialProgress()[tutorial.id]).toEqual({
        step: tutorial.steps.length - 1,
        completed: true,
      });
      await click(contextual);
      expectStep(tutorial, 0);
      await click(titleButton('Close tutorials and return to your work'));
      expect(document.querySelector('.lf-learn')).toBeNull();
      expect(document.activeElement).toBe(contextual);
      expect(useUiStore.getState().modalDepth).toBe(0);
      expect(useUiStore.getState().toolMode).toBe(tool);
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().redoStack).toBe(before.redoStack);
      expect(useStore.getState().dirty).toBe(before.dirty);
    },
  );

  it('the library return and first-project shortcut open their intended views', async () => {
    await act(async () =>
      root.render(
        <>
          <TutorialButton tutorialId="rectangle" />
          <TutorialHost />
        </>,
      ),
    );
    await click(element('[data-tutorial-id]', host));
    await click(titleButton('Return to the tutorial library'));
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    const firstProject = element<HTMLButtonElement>('.lf-learn-start');
    expect(firstProject.title).toBe('Open tutorial: Make your first project');
    await click(firstProject);
    expect(useTutorialStore.getState().tutorialId).toBe('first-project');
    expect(document.querySelector('.lf-learn-reader')).not.toBeNull();
  });

  it('every topic exposes exactly its lessons and keeps all other topics folded', async () => {
    const before = useStore.getState();
    await openLibrary();
    for (const category of new Set(TUTORIALS.map((tutorial) => tutorial.category))) {
      const section = await expandTopic(category);
      const expected = TUTORIALS.filter((tutorial) => tutorial.category === category)
        .map((tutorial) => `Open tutorial: ${tutorial.title}`)
        .sort();
      const actual = [...document.querySelectorAll<HTMLButtonElement>('.lf-learn-lesson-link')]
        .map((button) => button.title)
        .sort();
      expect(actual, category).toEqual(expected);
      expect(section.open).toBe(true);
      for (const other of document.querySelectorAll<HTMLDetailsElement>('.lf-learn-topic')) {
        if (other === section) continue;
        expect(other.open).toBe(false);
        expect(other.querySelector('.lf-learn-lesson-link')).toBeNull();
      }
    }
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(before.dirty);
  });

  it('every getting-started lesson returns to the same open topic', async () => {
    const before = useStore.getState();
    const tutorials = TUTORIALS.filter((tutorial) => tutorial.category === 'Getting started');
    await openLibrary();
    await expandTopic('Getting started');
    for (const tutorial of tutorials) {
      const section = await expandTopic('Getting started');
      const link = [...section.querySelectorAll<HTMLButtonElement>('.lf-learn-lesson-link')].find(
        (candidate) => candidate.title === `Open tutorial: ${tutorial.title}`,
      );
      if (link === undefined) throw new Error(`Missing getting-started lesson ${tutorial.id}`);
      await click(link);
      expect(useTutorialStore.getState().tutorialId).toBe(tutorial.id);
      expectStep(tutorial, 0);
      await click(titleButton('Return to the tutorial library'));
      expect(element<HTMLDetailsElement>('.lf-learn-topic[open]').textContent).toContain(
        'Getting started',
      );
      expect(useTutorialStore.getState().trail).toEqual([]);
    }
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });

  it('keeps the first-project shortcut available after completion and starts it at step one', async () => {
    const tutorial = TUTORIALS.find((candidate) => candidate.id === 'first-project');
    if (tutorial === undefined) throw new Error('Missing first-project lesson');
    localStorage.setItem(
      'kerfdesk.visual-tutorials.v1',
      JSON.stringify({ [tutorial.id]: { step: tutorial.steps.length - 1, completed: true } }),
    );
    await openLibrary();
    await click(element('.lf-learn-start'));
    expectStep(tutorial, 0);
    await click(titleButton('Return to the tutorial library'));
    expect(element('.lf-learn-start').textContent).toContain(tutorial.title);
  });
});
