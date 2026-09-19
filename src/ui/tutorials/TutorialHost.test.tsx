import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { AppMenuBar } from '../commands/AppMenuBar';
import type { AppCommand } from '../commands/command-types';
import { Dialog } from '../kit/Dialog';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { findTutorial, TUTORIALS } from './tutorial-catalog';
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

async function selectMachine(value: string): Promise<void> {
  const select = element<HTMLSelectElement>('select[title="Filter tutorials by machine type"]');
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
  expect(element('.lf-learn-lesson-heading h1').textContent).toBe(tutorial.title);
  expect(element('.lf-learn-step-detail h2').textContent).toBe(tutorial.steps[index]?.title);
  expect(element('[aria-current="step"]').textContent).toContain(tutorial.steps[index]?.title);
}

beforeEach(() => {
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
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
  useTutorialStore.setState({ isOpen: false, tutorialId: null });
  useUiStore.setState({ modalDepth: 0, toolMode: { kind: 'select' } });
});

describe('TutorialHost learning flow', () => {
  it('opens the contextual lesson, navigates, restarts and records completion in the library', async () => {
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
    await click(button('Read the next step'));
    await click(button('Restart from step one'));
    expectStep('rectangle', 0);

    const tutorial = lesson('rectangle');
    for (let step = 1; step < tutorial.steps.length; step += 1) {
      await click(button('Read the next step'));
      expectStep('rectangle', step);
    }
    await click(button('Mark this lesson complete on this device'));
    expect(button('Mark this lesson complete on this device').disabled).toBe(true);
    expect(element('.lf-learn-done[role="status"]').textContent).toContain('Lesson complete');
    expect(readTutorialProgress()['rectangle']).toEqual({
      step: tutorial.steps.length - 1,
      completed: true,
    });

    await escape();
    await click(opener);
    expectStep('rectangle', tutorial.steps.length - 1);
    await click(button('Return to the tutorial library'));
    const card = button(`Open tutorial: ${tutorial.title}`);
    expect(card.querySelector('.lf-learn-completed')?.textContent).toContain('Completed');
    expect(element('.lf-learn-progress-count').textContent).toContain('1 of');
    await click(card);
    await click(button('Restart from step one'));
    expectStep('rectangle', 0);
    expect(readTutorialProgress()['rectangle']).toEqual({ step: 0, completed: true });
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
    expect(document.querySelector('.lf-learn')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(useUiStore.getState().modalDepth).toBe(0);
    await click(opener);
    expectStep('rectangle', 2);

    await escape();
    expect(document.activeElement).toBe(opener);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rectangle: { step: 49, completed: false } }),
    );
    await click(opener);
    expectStep('rectangle', lesson('rectangle').steps.length - 1);
  });

  it('combines search, category and machine filters and resets all three after no results', async () => {
    await render(
      <>
        <TutorialButton />
        <TutorialHost />
      </>,
    );
    await click(element('[data-tutorial-id="library"]'));
    const cnc = lesson('cnc-vcarve');
    const laser = lesson('laser-cut');
    expect(document.querySelector(`button[title="Open tutorial: ${cnc.title}"]`)).toBeNull();
    expect(button(`Open tutorial: ${laser.title}`)).toBeDefined();

    await click(button('Show cnc tutorials'));
    expect(element<HTMLSelectElement>('select').value).toBe('cnc');
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    await selectMachine('laser');
    expect(button('Show all tutorials').getAttribute('aria-pressed')).toBe('true');
    expect(button(`Open tutorial: ${laser.title}`)).toBeDefined();
    expect(document.querySelector(`button[title="Open tutorial: ${cnc.title}"]`)).toBeNull();

    await selectMachine('cnc');
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    expect(document.querySelector(`button[title="Open tutorial: ${laser.title}"]`)).toBeNull();
    await click(button('Show cnc tutorials'));
    expect(button('Show cnc tutorials').getAttribute('aria-pressed')).toBe('true');
    for (const card of document.querySelectorAll('.lf-learn-card-meta')) {
      expect(card.firstElementChild?.textContent).toBe('CNC');
    }
    await search(cnc.title);
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
    expect(document.querySelectorAll('.lf-learn-card')).toHaveLength(1);
    await search('no-such-tool-7391');
    expect(element('.lf-learn-empty h3').textContent).toBe('No matching lessons');
    expect(document.querySelectorAll('.lf-learn-card')).toHaveLength(0);

    await click(button('Clear search and all tutorial filters'));
    expect(element<HTMLInputElement>('input[type="search"]').value).toBe('');
    expect(element<HTMLSelectElement>('select').value).toBe('all');
    expect(button('Show all tutorials').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.lf-learn-card')).toHaveLength(TUTORIALS.length);
    expect(button(`Open tutorial: ${laser.title}`)).toBeDefined();
    expect(button(`Open tutorial: ${cnc.title}`)).toBeDefined();
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
    await click(button('Show the result illustration'));
    expect(button('Show the result illustration').getAttribute('aria-pressed')).toBe('true');
    await click(button('Return to the tutorial library'));
    await click(button(`Open tutorial: ${lesson('text').title}`));
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
    expect(document.activeElement).toBe(summary);
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
