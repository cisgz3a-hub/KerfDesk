import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { TUTORIALS } from './tutorial-catalog';
import { useTutorialStore } from './tutorial-store';
import { TutorialButton } from './TutorialButton';
import { TutorialExample } from './TutorialExample';
import { TutorialHost } from './TutorialHost';
import { TutorialLibrary } from './TutorialLibrary';
import { TutorialReader } from './TutorialReader';

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
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function titleButton(title: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.title === title,
  );
  if (button === undefined) throw new Error(`Missing tutorial button ${title}`);
  return button;
}

async function click(button: HTMLElement): Promise<void> {
  await act(async () => {
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

describe('individual tutorial control outcomes', () => {
  it.each(TUTORIALS)(
    '$id card and contextual button open the named lesson without editing the project',
    async (tutorial) => {
      const before = useStore.getState();
      await act(async () =>
        root.render(
          <TutorialLibrary
            query={tutorial.title}
            setQuery={vi.fn()}
            category="All"
            setCategory={vi.fn()}
            machine="all"
            setMachine={vi.fn()}
            progress={{}}
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
      const contextual = host.querySelector<HTMLButtonElement>('[data-tutorial-id]');
      if (contextual === null) throw new Error('Missing contextual tutorial');
      await click(contextual);
      expect(document.querySelector('.lf-learn-lesson-heading h1')?.textContent).toBe(
        tutorial.title,
      );
      expect(document.querySelector('.lf-learn-step-detail h2')?.textContent).toBe(
        tutorial.steps[0]?.title,
      );
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().dirty).toBe(before.dirty);
      await click(titleButton('Close tutorials and return to your work'));
      expect(document.querySelector('.lf-learn')).toBeNull();
      expect(useUiStore.getState().modalDepth).toBe(0);
    },
  );

  it('the learning brand and first-project shortcut switch to their intended views', async () => {
    await act(async () =>
      root.render(
        <>
          <TutorialButton tutorialId="rectangle" />
          <TutorialHost />
        </>,
      ),
    );
    const opener = host.querySelector<HTMLButtonElement>('[data-tutorial-id]');
    if (opener === null) throw new Error('Missing opener');
    await click(opener);
    await click(titleButton('Browse all visual tutorials'));
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    const firstProject = document.querySelector<HTMLButtonElement>('.lf-learn-start-lead button');
    if (firstProject === null) throw new Error('Missing first project shortcut');
    const firstLesson = TUTORIALS.find((tutorial) => tutorial.id === 'first-project');
    expect(firstProject.title).toBe(`Open the lesson: ${firstLesson?.title}`);
    await click(firstProject);
    expect(useTutorialStore.getState().tutorialId).toBe('first-project');
    expect(document.querySelector('.lf-learn-reader')).not.toBeNull();
  });

  it('the other-machine link and every category show the exact matching lessons without editing the project', async () => {
    const before = useStore.getState();
    await openLibrary();
    const hidden = TUTORIALS.filter((tutorial) => tutorial.machine === 'cnc').length;
    const include = titleButton('Include lessons for the other machine type');
    expect(include.textContent).toBe(`${hidden} more for other machines`);
    expect(document.querySelectorAll('.lf-learn-card')).toHaveLength(TUTORIALS.length - hidden);
    await click(include);
    expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('all');
    expect(document.querySelectorAll('.lf-learn-card')).toHaveLength(TUTORIALS.length);
    expect(document.querySelector('.lf-learn-inline-link')).toBeNull();

    for (const category of ['All', ...new Set(TUTORIALS.map((tutorial) => tutorial.category))]) {
      await click(titleButton(`Show ${category.toLowerCase()} tutorials`));
      const expected = TUTORIALS.filter(
        (tutorial) => category === 'All' || tutorial.category === category,
      )
        .map((tutorial) => `Open tutorial: ${tutorial.title}`)
        .sort();
      const actual = [...document.querySelectorAll<HTMLButtonElement>('.lf-learn-card')]
        .map((card) => card.title)
        .sort();
      expect(actual, category).toEqual(expected);
      expect(
        titleButton(`Show ${category.toLowerCase()} tutorials`).getAttribute('aria-pressed'),
      ).toBe('true');
      expect(document.querySelector('.lf-learn-start') !== null).toBe(category === 'All');
    }
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
    expect(useStore.getState().dirty).toBe(before.dirty);
  });

  it('every opening-path button opens its named lesson and Back returns to the library', async () => {
    const before = useStore.getState();
    const path = TUTORIALS.filter((tutorial) => tutorial.category === 'Getting started');
    await openLibrary();
    expect(document.querySelectorAll('.lf-learn-path button')).toHaveLength(path.length);
    for (const tutorial of path) {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>('.lf-learn-path button'),
      ].find((candidate) => candidate.title === `Open the lesson: ${tutorial.title}`);
      if (button === undefined) throw new Error(`Missing opening-path lesson ${tutorial.id}`);
      await click(button);
      expect(useTutorialStore.getState().tutorialId).toBe(tutorial.id);
      expect(document.querySelector('.lf-learn-lesson-heading h1')?.textContent).toBe(
        tutorial.title,
      );
      expect(document.querySelector('.lf-learn-step-detail h2')?.textContent).toBe(
        tutorial.steps[0]?.title,
      );
      await click(titleButton('Return to the tutorial library (Escape)'));
      expect(document.querySelector('.lf-learn-library')).not.toBeNull();
      expect(useTutorialStore.getState().trail).toEqual([]);
    }
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });

  it('the primary Start skips completed opening lessons and disappears after the opening path is complete', async () => {
    const before = useStore.getState();
    const path = TUTORIALS.filter((tutorial) => tutorial.category === 'Getting started');
    const first = path[0];
    const next = path[1];
    if (first === undefined || next === undefined) throw new Error('Missing opening-path lessons');
    localStorage.setItem(
      'kerfdesk.visual-tutorials.v1',
      JSON.stringify({
        [first.id]: { step: first.steps.length - 1, completed: true },
      }),
    );
    await openLibrary();
    const primary = document.querySelector<HTMLButtonElement>('.lf-learn-start-lead button');
    if (primary === null) throw new Error('Missing next unfinished opening lesson');
    expect(primary.title).toBe(`Open the lesson: ${next.title}`);
    expect(primary.textContent).toContain('Start:');
    await click(primary);
    expect(useTutorialStore.getState().tutorialId).toBe(next.id);
    expect(document.querySelector('.lf-learn-step-detail h2')?.textContent).toBe(
      next.steps[0]?.title,
    );
    await click(titleButton('Close tutorials and return to your work'));

    localStorage.setItem(
      'kerfdesk.visual-tutorials.v1',
      JSON.stringify(
        Object.fromEntries(
          path.map((tutorial) => [
            tutorial.id,
            { step: tutorial.steps.length - 1, completed: true },
          ]),
        ),
      ),
    );
    await openLibrary();
    expect(document.querySelector('.lf-learn-start-lead button')).toBeNull();
    expect(document.querySelectorAll('.lf-learn-path button[data-done="yes"]')).toHaveLength(
      path.length,
    );
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      String(path.length),
    );
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });

  it('the related-lesson Back button restores its parent and then the library without editing the project', async () => {
    const before = useStore.getState();
    const parent = TUTORIALS.find((tutorial) => tutorial.id === 'first-project');
    const related = TUTORIALS.find((tutorial) => tutorial.id === parent?.related[0]);
    if (parent === undefined || related === undefined)
      throw new Error('Missing related lesson fixture');
    await openLibrary();
    await click(titleButton(`Open tutorial: ${parent.title}`));
    await click(titleButton(`Open related tutorial: ${related.title}`));
    expect(useTutorialStore.getState().trail).toEqual([parent.id]);
    expect(document.querySelector('.lf-learn-lesson-heading h1')?.textContent).toBe(related.title);
    await click(titleButton(`Back to ${parent.title} (Escape)`));
    expect(useTutorialStore.getState().tutorialId).toBe(parent.id);
    expect(document.querySelector('.lf-learn-lesson-heading h1')?.textContent).toBe(parent.title);
    expect(useTutorialStore.getState().trail).toEqual([]);
    await click(titleButton('Return to the tutorial library (Escape)'));
    expect(useTutorialStore.getState()).toMatchObject({
      isOpen: true,
      tutorialId: null,
      trail: [],
    });
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    expect(useStore.getState().project).toBe(before.project);
    expect(useStore.getState().undoStack).toBe(before.undoStack);
  });

  it('step-list and related-lesson buttons select the requested content', async () => {
    const tutorial = TUTORIALS.find((candidate) => candidate.id === 'rectangle');
    if (tutorial === undefined) throw new Error('Missing rectangle lesson');
    const remember = vi.fn();
    await act(async () =>
      root.render(<TutorialReader tutorial={tutorial} progress={undefined} remember={remember} />),
    );
    for (const [index, step] of tutorial.steps.entries()) {
      await click(titleButton(`Go to step ${index + 1}: ${step.title}`));
      expect(document.querySelector('.lf-learn-step-detail h2')?.textContent).toBe(step.title);
      expect(remember).toHaveBeenLastCalledWith(tutorial.id, index);
    }
    for (const id of tutorial.related) {
      const target = TUTORIALS.find((candidate) => candidate.id === id);
      if (target === undefined) throw new Error(`Missing related lesson ${id}`);
      await click(titleButton(`Open related tutorial: ${target.title}`));
      expect(useTutorialStore.getState().tutorialId).toBe(id);
    }
  });

  it('example stage selection and playback pause, advance and stop at Result', async () => {
    const tutorial = TUTORIALS.find((candidate) => candidate.id === 'rectangle');
    if (tutorial === undefined) throw new Error('Missing rectangle lesson');
    await act(async () =>
      root.render(
        <TutorialExample
          visual={tutorial.visual}
          phase={0}
          focus="Fixture example"
          result="Fixture result"
        />,
      ),
    );
    vi.useFakeTimers();
    await click(titleButton('Show the action illustration'));
    expect(titleButton('Show the action illustration').getAttribute('aria-pressed')).toBe('true');
    await click(titleButton('Play the three example stages'));
    expect(titleButton('Show the before illustration').getAttribute('aria-pressed')).toBe('true');
    await act(async () => vi.advanceTimersByTime(1400));
    expect(titleButton('Show the action illustration').getAttribute('aria-pressed')).toBe('true');
    await click(titleButton('Pause example playback'));
    await act(async () => vi.advanceTimersByTime(2800));
    expect(titleButton('Show the action illustration').getAttribute('aria-pressed')).toBe('true');
    await click(titleButton('Play the three example stages'));
    for (let stage = 0; stage < 3; stage += 1) await act(async () => vi.advanceTimersByTime(1400));
    expect(titleButton('Show the result illustration').getAttribute('aria-pressed')).toBe('true');
    expect(titleButton('Play the three example stages')).toBeDefined();
  });
});
