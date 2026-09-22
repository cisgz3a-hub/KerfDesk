import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { AppMenuBar } from '../commands/AppMenuBar';
import type { AppCommand } from '../commands/command-types';
import { Dialog } from '../kit/Dialog';
import { useStore } from '../state/store';
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

function element<T extends HTMLElement>(selector: string, scope: ParentNode = document): T {
  const result = scope.querySelector<T>(selector);
  if (result === null) throw new Error(`Missing tutorial control: ${selector}`);
  return result;
}

function button(title: string): HTMLButtonElement {
  return element<HTMLButtonElement>(`button[title="${title}"]`);
}

function lesson(id: string): NonNullable<ReturnType<typeof findTutorial>> {
  const result = findTutorial(id);
  if (result === undefined) throw new Error(`Missing lesson: ${id}`);
  return result;
}

async function render(node: JSX.Element): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
}

async function click(control: HTMLElement): Promise<void> {
  await act(async () => {
    control.focus();
    control.click();
    // Resolve the real lazy boundary; no replacement reader or mock catalog.
    await import('./TutorialCentre');
  });
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

async function search(value: string): Promise<void> {
  const input = element<HTMLInputElement>('input[type="search"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function topic(category: string): HTMLDetailsElement {
  const result = [...document.querySelectorAll<HTMLDetailsElement>('.lf-learn-topic')].find(
    (item) => item.querySelector('summary')?.textContent?.includes(category),
  );
  if (result === undefined) throw new Error(`Missing tutorial topic: ${category}`);
  return result;
}

async function expandTopic(category: string): Promise<void> {
  const section = topic(category);
  if (!section.open) await click(element('summary', section));
}

async function escape(): Promise<void> {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

function expectStep(id: string, index: number): void {
  const tutorial = lesson(id);
  expect(element('h1.lf-learn-lesson-heading').textContent).toBe(tutorial.title);
  expect(element('.lf-learn-step-detail h2').textContent).toBe(tutorial.steps[index]?.title);
  expect(element('.lf-learn-step-count').textContent).toBe(
    `Step ${index + 1} of ${tutorial.steps.length}`,
  );
}

beforeEach(() => {
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  useUiStore.setState({ modalDepth: 0, toolMode: { kind: 'draw', shape: 'rect' } });
  useStore.setState({ project: createProject(), undoStack: [], redoStack: [], dirty: false });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  expect(useUiStore.getState().modalDepth).toBe(0);
  host?.remove();
  host = null;
  root = null;
  vi.restoreAllMocks();
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  useUiStore.setState({ modalDepth: 0, toolMode: { kind: 'select' } });
});

describe('TutorialHost learning flow', () => {
  it('guides the reader through the lesson and returns to work when Done is pressed', async () => {
    await render(
      <>
        <TutorialButton tutorialId="rectangle" />
        <TutorialHost />
      </>,
    );
    const opener = element('[data-tutorial-id="rectangle"]');
    await click(opener);
    expectStep('rectangle', 0);
    expect(button('Read the previous step').disabled).toBe(true);

    await click(button('Read the next step'));
    expectStep('rectangle', 1);
    expect(document.activeElement).toBe(element('.lf-learn-step-detail h2'));
    await click(button('Read the previous step'));
    expectStep('rectangle', 0);

    const tutorial = lesson('rectangle');
    for (let step = 1; step < tutorial.steps.length; step += 1) {
      await click(button('Read the next step'));
      expectStep('rectangle', step);
    }
    expect(document.querySelector('button[title="Read the next step"]')).toBeNull();
    const done = button('Finish tutorial and return to your work');
    expect(done.textContent).toBe('Done');
    await click(done);
    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(readTutorialProgress()['rectangle']).toEqual({
      step: tutorial.steps.length - 1,
      completed: true,
    });

    await click(opener);
    expectStep('rectangle', 0);
    expect(button('Read the previous step').disabled).toBe(true);
  });

  it('resumes saved progress after closing and safely clamps a saved step from an older lesson', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rectangle: { step: 1, completed: false } }));
    await render(
      <>
        <TutorialButton tutorialId="rectangle" />
        <TutorialHost />
      </>,
    );
    const opener = element('[data-tutorial-id="rectangle"]');
    await click(opener);
    expectStep('rectangle', 1);
    await click(button('Read the next step'));
    await escape();
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    await escape();
    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(useUiStore.getState().modalDepth).toBe(0);
    await click(opener);
    expectStep('rectangle', 2);

    await escape();
    await escape();
    expect(document.activeElement).toBe(opener);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rectangle: { step: 49, completed: false } }),
    );
    await click(opener);
    expectStep('rectangle', lesson('rectangle').steps.length - 1);
  });

  it('keeps topics folded until needed and searches across both machine types', async () => {
    await render(
      <>
        <TutorialButton />
        <TutorialHost />
      </>,
    );
    await click(element('[data-tutorial-id="library"]'));
    const cnc = lesson('cnc-vcarve');
    const laser = lesson('laser-cut');
    expect(button(`Open tutorial: ${lesson('first-project').title}`)).toBeDefined();
    expect(document.querySelectorAll('.lf-learn-topic').length).toBeGreaterThan(0);
    for (const section of document.querySelectorAll<HTMLDetailsElement>('.lf-learn-topic')) {
      expect(section.open).toBe(false);
      expect(section.querySelector('.lf-learn-lesson-link')).toBeNull();
    }
    expect(document.querySelector(`button[title="Open tutorial: ${cnc.title}"]`)).toBeNull();
    expect(document.querySelector(`button[title="Open tutorial: ${laser.title}"]`)).toBeNull();

    await expandTopic(cnc.category);
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    await click(element('summary', topic(cnc.category)));
    expect(topic(cnc.category).querySelector('.lf-learn-lesson-link')).toBeNull();

    await search(cnc.title);
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    await search(laser.title);
    expect(button(`Open tutorial: ${laser.title}`)).toBeDefined();
    await search('no-such-tool-7391');
    expect(element('.lf-learn-empty h2').textContent).toBe('No matching tutorials');
    expect(document.querySelectorAll('.lf-learn-lesson-link')).toHaveLength(0);

    await click(button('Clear tutorial search'));
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe('');
    expect(button(`Open tutorial: ${lesson('first-project').title}`)).toBeDefined();
    expect(document.querySelector('.lf-learn-empty')).toBeNull();
  });

  it('returns to the same topic or search after reading a lesson', async () => {
    await render(
      <>
        <TutorialButton />
        <TutorialHost />
      </>,
    );
    await click(element('[data-tutorial-id="library"]'));
    const rectangle = lesson('rectangle');
    await expandTopic(rectangle.category);
    await click(button(`Open tutorial: ${rectangle.title}`));
    expectStep('rectangle', 0);
    await click(button('Return to the tutorial library'));
    expect(topic(rectangle.category).open).toBe(true);
    expect(button(`Open tutorial: ${rectangle.title}`)).toBeDefined();

    const cnc = lesson('cnc-vcarve');
    await search(cnc.title);
    await click(button(`Open tutorial: ${cnc.title}`));
    expectStep('cnc-vcarve', 0);
    await click(button('Return to the tutorial library'));
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe(cnc.title);
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    await search('');
    expect(topic(rectangle.category).open).toBe(true);
  });

  it('keeps topics reachable before keyboard focus wraps within the library', async () => {
    await render(
      <>
        <TutorialButton />
        <TutorialHost />
      </>,
    );
    await click(element('[data-tutorial-id="library"]'));
    const dialog = element('.lf-learn-backdrop');
    const markVisible = (): void => {
      // jsdom has no layout; expose the controls that this library visibly renders.
      for (const control of dialog.querySelectorAll('button, input, summary')) {
        Object.defineProperty(control, 'offsetParent', { configurable: true, value: dialog });
      }
    };
    const pressTab = async (control: HTMLElement, shiftKey = false): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        control.focus();
        control.dispatchEvent(event);
      });
      return event;
    };
    markVisible();

    // Tab's native movement is not simulated by jsdom. It must remain unblocked
    // here so the browser can reach the topic summaries after the starter button.
    const starter = button(`Open tutorial: ${lesson('first-project').title}`);
    expect((await pressTab(starter)).defaultPrevented).toBe(false);

    const lastTopic = element('.lf-learn-topic:last-child > summary');
    const close = button('Close tutorials and return to your work');
    expect((await pressTab(lastTopic)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect((await pressTab(close, true)).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastTopic);

    const category = lesson('rectangle').category;
    await expandTopic(category);
    markVisible();
    const lastLesson = element('.lf-learn-lessons li:last-child button', topic(category));
    expect((await pressTab(lastLesson)).defaultPrevented).toBe(false);
  });

  it('keeps extra help folded until the reader asks for it', async () => {
    await render(
      <>
        <TutorialButton tutorialId="rectangle" />
        <TutorialHost />
      </>,
    );
    await click(element('[data-tutorial-id="rectangle"]'));
    const notes = element<HTMLDetailsElement>('details.lf-learn-notes');
    const summary = element('summary', notes);
    expect(summary.textContent).toBe('More help');
    expect(notes.open).toBe(false);
    await click(summary);
    expect(notes.open).toBe(true);
    expect(notes.textContent).toContain(lesson('rectangle').tip);
    expectStep('rectangle', 0);
  });

  it('keeps a nested dialog draft and project intact and restores its tutorial opener on Escape', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());
    const projectBefore = useStore.getState();
    const toolBefore = useUiStore.getState().toolMode;
    await render(
      <>
        <Dialog title="Array" tutorialId="array" as="form" onClose={onClose} onSubmit={onSubmit}>
          <input aria-label="Rows" defaultValue="2" />
          <button type="submit">Create array</button>
        </Dialog>
        <TutorialHost />
      </>,
    );
    const rows = element<HTMLInputElement>('input[aria-label="Rows"]');
    rows.value = '7';
    const opener = element('[data-tutorial-id="array"]');
    expect(useUiStore.getState().modalDepth).toBe(1);
    await click(opener);
    expect(useUiStore.getState().modalDepth).toBe(2);
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(2);
    await click(button('Read the next step'));
    await click(button('Return to the tutorial library'));
    await expandTopic(lesson('text').category);
    await click(button(`Open tutorial: ${lesson('text').title}`));
    expect(useUiStore.getState().modalDepth).toBe(2);
    await escape();
    expect(document.querySelector('.lf-learn-library')).not.toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(2);
    await escape();

    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    expect(useUiStore.getState().modalDepth).toBe(1);
    expect(rows.value).toBe('7');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(projectBefore.project);
    expect(useStore.getState().undoStack).toBe(projectBefore.undoStack);
    expect(useStore.getState().redoStack).toBe(projectBefore.redoStack);
    expect(useStore.getState().dirty).toBe(projectBefore.dirty);
    expect(useUiStore.getState().toolMode).toBe(toolBefore);
    expect(document.activeElement).toBe(opener);
  });

  it('returns to Help after opening the tutorial library through its ordinary menu command', async () => {
    const command: AppCommand = {
      id: 'help.tutorials',
      family: 'help',
      label: 'Visual tutorials…',
      title: 'Browse visual tutorials',
      enabled: true,
      invoke: () => useTutorialStore.getState().openTutorial(),
    };
    await render(
      <>
        <AppMenuBar commands={[command]} machineKind="laser" />
        <TutorialHost />
      </>,
    );
    const summary = element<HTMLElement>('summary[data-menu-family-summary="help"]');
    await click(summary);
    await click(element('[data-help-id="command:help.tutorials"]'));
    expect(document.querySelector('.lf-learn')).not.toBeNull();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    await escape();
    expect(document.activeElement).toBe(summary);
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

  it('makes a disabled command lesson usable without running that command or losing menu focus', async () => {
    const invoke = vi.fn();
    const command: AppCommand = {
      id: 'tools.trace-image',
      family: 'tools',
      label: 'Trace Image...',
      title: 'Select an image first',
      enabled: false,
      disabledReason: 'Select an image first.',
      invoke,
    };
    await render(
      <>
        <AppMenuBar commands={[command]} machineKind="laser" />
        <TutorialHost />
      </>,
    );
    const summary = element<HTMLElement>('summary[data-menu-family-summary="tools"]');
    await click(summary);
    const action = element<HTMLButtonElement>('[data-help-id="command:tools.trace-image"]');
    expect(action.disabled).toBe(true);
    const tutorial = element<HTMLButtonElement>('[data-tutorial-id="trace"]');
    expect(tutorial.disabled).toBe(false);
    await click(tutorial);
    expectStep('trace', 0);
    expect(invoke).not.toHaveBeenCalled();
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    await escape();
    await escape();
    expect(document.activeElement).toBe(summary);
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
