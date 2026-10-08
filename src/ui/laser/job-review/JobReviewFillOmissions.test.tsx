import { act } from 'react';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changedArtwork,
  clearFillReviewState,
  fillArtwork,
  prepareReview,
  resetFillReviewState,
  reviewModel,
  reviewProject,
} from '../../../__fixtures__/fill-omission-review';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state/store';
import { useUiStore } from '../../state/ui-store';
import { JobReviewDialog } from './JobReviewDialog';
import { useJobReviewStore } from './job-review-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const nearCurve = 'M10 10 C20 10 20 20 10 20 L10.25 10.25';
const originalActions = {
  sendConsoleCommand: useLaserStore.getState().sendConsoleCommand,
  writeGrblSetting: useLaserStore.getState().writeGrblSetting,
  startJob: useLaserStore.getState().startJob,
};
const consoleWrite = vi.fn(async () => undefined);
const settingWrite = vi.fn(async () => undefined);
const startWrite = vi.fn(async () => undefined);
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetFillReviewState();
  vi.clearAllMocks();
  useLaserStore.setState({
    sendConsoleCommand: consoleWrite,
    writeGrblSetting: settingWrite,
    startJob: startWrite,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  clearFillReviewState();
  useLaserStore.setState(originalActions);
});

describe('Show omitted artwork from Job Review', () => {
  it('offers the advisory action without changing the project, selection, history or Start gate merely by opening review', async () => {
    const model = reviewModel(await prepareReview(reviewProject()));
    const before = useStore.getState();
    useJobReviewStore.getState().open(model);

    await renderReview();

    expect.soft(findButton('Show omitted artwork')).toBeDefined();
    expect(button('Start job').disabled).toBe(false);
    expect(useStore.getState().project).toBe(before.project);
    expect(selection()).toEqual(['control']);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
    expect(useUiStore.getState().zoomFactor).toBe(1);
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expectNoSerialWrites();
    await act(async () => button('Start job').click());
    expect(useJobReviewStore.getState().pendingSignal).toBe('confirm');
    expectNoSerialWrites();
  });

  it('cancels the pending run and reveals only matching omitted artwork with selection, zoom and the Artwork rail', async () => {
    const model = reviewModel(await prepareReview(reviewProject()));
    const before = useStore.getState().project;
    useJobReviewStore.getState().open(model);
    await renderReview();
    const signal = useJobReviewStore.getState().nextSignal();

    await act(async () => button('Show omitted artwork').click());

    await expect(signal).resolves.toBe('cancel');
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(selection()).toEqual(['omitted-a', 'omitted-b']);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    // The distant control would make a whole-job fit smaller than 2.
    expect(useUiStore.getState().zoomFactor).toBeGreaterThan(3);
    expect(useUiStore.getState().cutsLayersView).toBe('layers');
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
    expect(useUiStore.getState().railPanelFocusRequest?.panel).toBe('layers');
    expectNoSerialWrites();
  });

  it('does nothing when the reviewed ID has been replaced by changed artwork before the click', async () => {
    const source = reviewProject([fillArtwork('omitted-a', nearCurve)]);
    const model = reviewModel(await prepareReview(source));
    useJobReviewStore.getState().open(model);
    await renderReview();
    const show = button('Show omitted artwork');
    const changed = changedArtwork(source, 'omitted-a');
    await act(async () => useStore.setState({ project: changed }));

    await act(async () => show.click());

    expect(selection()).toEqual(['control']);
    expect(useStore.getState().project).toBe(changed);
    expect(useJobReviewStore.getState().state.kind).toBe('open');
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expect(useUiStore.getState().zoomFactor).toBe(1);
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
    expectNoSerialWrites();
  });

  it('retains a matching omission while rejecting another stale object with the same ID', async () => {
    const source = reviewProject();
    const model = reviewModel(await prepareReview(source));
    useJobReviewStore.getState().open(model);
    await renderReview();
    const show = button('Show omitted artwork');
    const changed = changedArtwork(source, 'omitted-b');
    await act(async () => useStore.setState({ project: changed }));

    await act(async () => show.click());

    expect(selection()).toEqual(['omitted-a']);
    expect(useStore.getState().project).toBe(changed);
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
    expectNoSerialWrites();
  });

  it('uses regenerated model IDs after a review rebuild rather than a captured old omission list', async () => {
    const source = reviewProject();
    useJobReviewStore.getState().open(reviewModel(await prepareReview(source)));
    await renderReview();
    const repairedA = {
      ...source,
      scene: {
        ...source.scene,
        objects: source.scene.objects.filter((object) => object.id !== 'omitted-a'),
      },
    };
    await act(async () => {
      useJobReviewStore.getState().beginPrepare();
      const rebuilt = reviewModel(await prepareReview(repairedA));
      useJobReviewStore.getState().completePrepare(rebuilt);
    });

    await act(async () => button('Show omitted artwork').click());

    expect(selection()).toEqual(['omitted-b']);
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expectNoSerialWrites();
  });

  it('reveals only prepared selected-output omissions without expanding to unrelated group members', async () => {
    const original = reviewProject();
    const source = {
      ...original,
      scene: {
        ...original.scene,
        groups: [{ id: 'mixed', name: 'Mixed group', objectIds: ['omitted-a', 'control'] }],
      },
    };
    const scope = {
      ...DEFAULT_OUTPUT_SCOPE,
      cutSelectedGraphics: true,
      selectedObjectIds: ['omitted-a', 'control'],
    };
    useJobReviewStore.getState().open(reviewModel(await prepareReview(source, scope)));
    await renderReview();

    await act(async () => button('Show omitted artwork').click());

    expect(selection()).toEqual(['omitted-a']);
    expect(useStore.getState().project.scene.objects).toBe(source.scene.objects);
    expect(useStore.getState().project.scene.groups).toBe(source.scene.groups);
    expect(useStore.getState().project.jobSetup.outputScope.selectedObjectIds).toEqual([
      'omitted-a',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expectNoSerialWrites();
  });

  it('recognises unchanged source content after a worker-style structured clone', async () => {
    const source = reviewProject();
    useJobReviewStore.getState().open(reviewModel(await prepareReview(source)));
    await renderReview();
    const clone = structuredClone(source);
    await act(async () => useStore.setState({ project: clone }));

    await act(async () => button('Show omitted artwork').click());

    expect(selection()).toEqual(['omitted-a', 'omitted-b']);
    expect(useStore.getState().project).toBe(clone);
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expectNoSerialWrites();
  });

  it('does not parse fabricated object IDs from a legacy archived warning without omission source data', async () => {
    const actual = reviewModel(await prepareReview(reviewProject()));
    const { openFillOmissions: _omissions, ...legacy } = actual;
    useJobReviewStore.getState().open({
      ...legacy,
      warnings: ['Archived job omitted 1 open Fill contour for fabricated-id.'],
    });

    await renderReview();

    expect(findButton('Show omitted artwork')).toBeUndefined();
    expect(selection()).toEqual(['control']);
    expect(button('Start job').disabled).toBe(false);
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expectNoSerialWrites();
  });

  it('does not offer source-canvas repair navigation from a painted second-pass review', async () => {
    const model = reviewModel(await prepareReview(reviewProject()));
    const before = useStore.getState().project;
    useJobReviewStore.getState().open(model, 'laser-second-pass');

    await renderReview();

    expect(findButton('Show omitted artwork')).toBeUndefined();
    expect(selection()).toEqual(['control']);
    expect(useStore.getState().project).toBe(before);
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expectNoSerialWrites();
  });
});

async function renderReview(): Promise<void> {
  root = createRoot(host);
  await act(async () => root?.render(<JobReviewDialog />));
}

function findButton(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
}

function button(text: string): HTMLButtonElement {
  const found = findButton(text);
  if (found === undefined) throw new Error('Expected review button: ' + text);
  return found;
}

function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].sort();
}

function expectNoSerialWrites(): void {
  expect(consoleWrite).not.toHaveBeenCalled();
  expect(settingWrite).not.toHaveBeenCalled();
  expect(startWrite).not.toHaveBeenCalled();
}
