// ADR-683: Job Review names stacked Fill copies that cancel and burn nothing,
// and, like LightBurn's "Show Me", selects the extra copy of each so one
// Delete leaves the other to burn.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearFillReviewState,
  fillArtwork,
  prepareReview,
  resetFillReviewState,
  reviewModel,
  reviewProject,
} from '../../../__fixtures__/fill-omission-review';
import { useStore } from '../../state/store';
import { JobReviewDialog } from './JobReviewDialog';
import { useJobReviewStore } from './job-review-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plate = 'M100 100 H140 V130 H100 Z';
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetFillReviewState();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  clearFillReviewState();
});

describe('stacked Fill copies in Job Review', () => {
  it('warns that the copies burn nothing and selects the extra copy to delete', async () => {
    const source = reviewProject([
      fillArtwork('plate', plate, true),
      fillArtwork('copy', plate, true),
    ]);
    const model = reviewModel(await prepareReview(source));

    expect(
      model.warnings.some((warning) => /stacked copies on Fill .* burn nothing/.test(warning)),
    ).toBe(true);
    expect(model.stackedFillCopies?.sources.map((source) => source.objectId)).toEqual(['copy']);

    useJobReviewStore.getState().open(model);
    root = createRoot(host);
    await act(async () => root?.render(<JobReviewDialog />));
    const signal = useJobReviewStore.getState().nextSignal();
    await act(async () => showButton()?.click());

    await expect(signal).resolves.toBe('cancel');
    expect(useStore.getState().selectedObjectId).toBe('copy');
    expect([...useStore.getState().additionalSelectedIds]).toEqual([]);
    expect(useStore.getState().project).toBe(source);
  });

  it('offers nothing for one plate', async () => {
    const model = reviewModel(
      await prepareReview(reviewProject([fillArtwork('plate', plate, true)])),
    );

    expect(model.stackedFillCopies).toBeUndefined();
    useJobReviewStore.getState().open(model);
    root = createRoot(host);
    await act(async () => root?.render(<JobReviewDialog />));
    expect(showButton()).toBeUndefined();
  });
});

function showButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Show stacked copies',
  );
}
