import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { findTutorial } from './tutorial-catalog';
import { TUTORIAL_PHOTOS, tutorialPhotoUrl, type TutorialPhoto } from './tutorial-photos';
import { useTutorialStore } from './tutorial-store';
import { TutorialHost } from './TutorialHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function element<T extends Element>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (result === null) throw new Error(`Missing tutorial element: ${selector}`);
  return result;
}

function button(title: string): HTMLButtonElement {
  return element<HTMLButtonElement>(`button[title="${title}"]`);
}

function photo(id: string): TutorialPhoto {
  const result = TUTORIAL_PHOTOS[id];
  if (result === undefined) throw new Error(`Missing tutorial picture: ${id}`);
  return result;
}

function lesson(id: string): NonNullable<ReturnType<typeof findTutorial>> {
  const result = findTutorial(id);
  if (result === undefined) throw new Error(`Missing tutorial: ${id}`);
  return result;
}

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<TutorialHost />);
  });
}

async function open(id?: string): Promise<void> {
  await act(async () => {
    useTutorialStore.getState().openTutorial(id);
    // Exercise the actual lazy reader, catalog, image and SVG fallback.
    await import('./TutorialCentre');
  });
}

async function click(control: HTMLElement): Promise<void> {
  await act(async () => control.click());
}

async function expandTopic(category: string): Promise<void> {
  const section = [...document.querySelectorAll<HTMLDetailsElement>('.lf-learn-topic')].find(
    (item) => item.querySelector('summary')?.textContent?.includes(category),
  );
  const summary = section?.querySelector('summary');
  if (summary === undefined || summary === null)
    throw new Error(`Missing tutorial topic: ${category}`);
  if (section?.open !== true) await click(summary);
}

async function failImage(): Promise<void> {
  await act(async () => {
    element<HTMLImageElement>('img.lf-learn-photo').dispatchEvent(new Event('error'));
  });
}

function expectPhase(picture: TutorialPhoto, phase: number): void {
  const image = element<HTMLImageElement>('img.lf-learn-photo');
  const translation = Number.parseFloat(image.style.transform.match(/-?[\d.]+/u)?.[0] ?? 'NaN');
  expect(phase).toBeGreaterThanOrEqual(0);
  expect(phase).toBeLessThan(picture.frames.length);
  expect(translation).toBeCloseTo((-phase * 100) / picture.frames.length);
  expect(image.alt).toBe(picture.frames[phase]?.alt);
}

beforeEach(() => {
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  useUiStore.setState({ modalDepth: 0, toolMode: { kind: 'draw', shape: 'rect' } });
  useStore.setState({ project: createProject(), undoStack: [], redoStack: [], dirty: false });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  useTutorialStore.setState({ isOpen: false, tutorialId: null, trail: [] });
  expect(useUiStore.getState().modalDepth).toBe(0);
  useUiStore.setState({ toolMode: { kind: 'select' } });
});

describe('tutorial pictures in the real reader', () => {
  it('mounts no images while closed or browsing, and only the selected lesson picture when open', async () => {
    await mount();
    expect(document.querySelectorAll('img, picture, link[as="image"]')).toHaveLength(0);
    await open();
    expect(document.querySelectorAll('.lf-learn-topic').length).toBeGreaterThan(0);
    await expandTopic(lesson('registration').category);
    expect(document.querySelectorAll('img, picture, link[as="image"]')).toHaveLength(0);

    await click(button(`Open tutorial: ${lesson('registration').title}`));
    expect(document.querySelectorAll('img')).toHaveLength(1);
    const image = element<HTMLImageElement>('img.lf-learn-photo');
    const { asset } = photo('registration');
    expect(image.getAttribute('src')).toBe(tutorialPhotoUrl(asset.small.file));
    expect(image.getAttribute('srcset')).toBe(
      `${tutorialPhotoUrl(asset.small.file)} 480w, ${tutorialPhotoUrl(asset.large.file)} 960w`,
    );
    expect(image.getAttribute('sizes')).toContain('max-width');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.width).toBe(asset.large.width);
    expect(image.height).toBe(asset.large.height);
    expect(image.src).not.toMatch(/^(?:data|blob):/u);
    expect(new URL(image.src).origin).toBe(location.origin);

    await click(button('Return to the tutorial library'));
    expect(document.querySelectorAll('img')).toHaveLength(0);
    await open('laser-image');
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(element<HTMLImageElement>('img').getAttribute('src')).toBe(
      tutorialPhotoUrl(photo('laser-image').asset.small.file),
    );
    await click(button('Close tutorials and return to your work'));
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('maps the four registration instructions to outline, outline, placement and engraving', async () => {
    await mount();
    await open('registration');
    const picture = photo('registration');
    const tutorial = lesson('registration');
    const phases = [0, 0, 1, 2];
    expect(tutorial.steps).toHaveLength(phases.length);
    for (const [index, phase] of phases.entries()) {
      if (index > 0) await click(button('Read the next step'));
      expectPhase(picture, phase);
      expect(element('.lf-learn-step-detail h2').textContent).toBe(tutorial.steps[index]?.title);
    }
    expect(document.querySelector('button[title="Read the next step"]')).toBeNull();
    await click(button('Read the previous step'));
    expectPhase(picture, 1);
    await click(button('Read the previous step'));
    expectPhase(picture, 0);
    await click(button('Read the previous step'));
    expectPhase(picture, 0);
    expect(button('Read the previous step').disabled).toBe(true);
  });

  it('falls back to SVG after failure and retries naturally on the next instruction', async () => {
    await mount();
    await open('registration');
    await failImage();
    expect(document.querySelector('img')).toBeNull();
    expect(element('.lf-learn-example svg[role="img"]')).toBeDefined();
    expect(element('.lf-learn-instruction').textContent).toBe(
      lesson('registration').steps[0].instruction,
    );
    await click(button('Read the next step'));
    expect(element('.lf-learn-step-detail h2').textContent).toBe(
      lesson('registration').steps[1].title,
    );
    expectPhase(photo('registration'), 0);
    expect(document.querySelector('.lf-learn-example svg[role="img"]')).toBeNull();
    await click(button('Read the previous step'));
    expectPhase(photo('registration'), 0);
  });

  it('retries a failed picture when the lesson is reopened', async () => {
    await mount();
    await open('registration');
    await failImage();
    expect(document.querySelector('img')).toBeNull();
    await click(button('Close tutorials and return to your work'));
    await open('registration');
    expectPhase(photo('registration'), 0);
    expect(document.querySelector('.lf-learn-example svg[role="img"]')).toBeNull();
  });

  it.each(Object.keys(TUTORIAL_PHOTOS))(
    'keeps every normal %s step inside its picture frames',
    async (id) => {
      await mount();
      await open(id);
      const picture = photo(id);
      const tutorial = lesson(id);
      for (const [index, step] of tutorial.steps.entries()) {
        if (index > 0) await click(button('Read the next step'));
        const phase = picture.frames.length === 1 ? 0 : (step.examplePhase ?? Math.min(index, 2));
        expectPhase(picture, phase);
        expect(document.querySelectorAll('img')).toHaveLength(1);
        expect(element<HTMLImageElement>('img').getAttribute('src')).toBe(
          tutorialPhotoUrl(picture.asset.small.file),
        );
      }
      await click(button('Finish tutorial and return to your work'));
      expect(document.querySelector('.lf-learn')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
    },
  );

  it('clamps stale saved progress to the last written step and its mapped picture', async () => {
    localStorage.setItem(
      'kerfdesk.visual-tutorials.v1',
      JSON.stringify({ registration: { step: 12, completed: false } }),
    );
    await mount();
    await open('registration');
    expect(element('.lf-learn-step-detail h2').textContent).toBe(
      lesson('registration').steps[3]?.title,
    );
    expectPhase(photo('registration'), 2);
  });

  it('does not mutate project, history or active tool through reading and picture recovery', async () => {
    const before = useStore.getState();
    const serialisedProject = JSON.stringify(before.project);
    const tool = useUiStore.getState().toolMode;
    const changed = vi.fn();
    const unsubscribe = useStore.subscribe(changed);
    try {
      await mount();
      await open('registration');
      await click(button('Read the next step'));
      await failImage();
      await click(button('Read the next step'));
      expectPhase(photo('registration'), 1);
      await click(button('Return to the tutorial library'));
      await click(button('Close tutorials and return to your work'));
      expect(changed).not.toHaveBeenCalled();
      expect(useStore.getState().project).toBe(before.project);
      expect(JSON.stringify(useStore.getState().project)).toBe(serialisedProject);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().redoStack).toBe(before.redoStack);
      expect(useStore.getState().dirty).toBe(before.dirty);
      expect(useUiStore.getState().toolMode).toBe(tool);
    } finally {
      unsubscribe();
    }
  });
});
