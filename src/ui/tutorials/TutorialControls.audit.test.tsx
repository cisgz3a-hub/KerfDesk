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
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
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
      await click(titleButton('Close tutorials and return to your work (Escape)'));
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
    const firstProject = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start your first project'),
    );
    if (firstProject === undefined) throw new Error('Missing first project shortcut');
    await click(firstProject);
    expect(useTutorialStore.getState().tutorialId).toBe('first-project');
    expect(document.querySelector('.lf-learn-reader')).not.toBeNull();
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
