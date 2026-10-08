import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import {
  clearFillReviewState,
  fillArtwork,
  prepareReview,
  resetFillReviewState,
  reviewModel,
  reviewProject,
} from '../../../__fixtures__/fill-omission-review';
import { useStore } from '../../state/store';

const nearCurve = 'M10 10 C20 10 20 20 10 20 L10.25 10.25';

beforeEach(() => resetFillReviewState());
afterEach(() => clearFillReviewState());

describe('open Fill omission data in Job Review', () => {
  it('identifies canonical effective Fill omissions in the exact prepared source, not the current canvas', async () => {
    const bundle = await prepareReview(reviewProject());
    const foreign = reviewProject([fillArtwork('foreign', nearCurve)]);
    useStore.setState({ project: foreign });

    const model = reviewModel(bundle, { project: foreign });

    expect(model.openFillOmissions).toMatchObject({
      objectIds: ['omitted-a', 'omitted-b'],
      contourCount: 3,
    });
    expect(bundle.prepared.gcode).toMatch(/^G1 /m);
    expect(useStore.getState().project).toBe(foreign);
  });

  it('limits omitted IDs and contours to the prepared selected-artwork output scope', async () => {
    const scope = {
      ...DEFAULT_OUTPUT_SCOPE,
      cutSelectedGraphics: true,
      selectedObjectIds: ['omitted-a', 'control'],
    };
    const bundle = await prepareReview(reviewProject(), scope);

    const model = reviewModel(bundle);

    expect(model.openFillOmissions).toMatchObject({ objectIds: ['omitted-a'], contourCount: 2 });
    expect(bundle.outputScope).toEqual(scope);
  });

  it('regenerates omission IDs and counts after the source artwork is actually repaired', async () => {
    const bundle = await prepareReview(reviewProject());
    const original = reviewModel(bundle);
    useStore.setState({ selectedObjectId: 'omitted-a', additionalSelectedIds: new Set() });
    // A owns both a near contour and a 2 mm gap under legacy flag-only closure.
    useStore.getState().closeSelectedOpenFillContoursWithTolerance(3);
    const rebuilt = reviewModel(await prepareReview(useStore.getState().project));

    expect(original.openFillOmissions).toMatchObject({
      objectIds: ['omitted-a', 'omitted-b'],
      contourCount: 3,
    });
    expect(rebuilt.openFillOmissions).toMatchObject({ objectIds: ['omitted-b'], contourCount: 1 });
  });

  it('does not invent editable source IDs for an archived recovery preparation', async () => {
    const bundle = await prepareReview(reviewProject());
    const archived = { ...bundle.prepared, laserResumeChain: [] };

    expect(reviewModel(bundle, { prepared: archived }).openFillOmissions).toBeUndefined();
  });

  it('keeps painted second-pass review detached from open source Fill contours', async () => {
    const bundle = await prepareReview(reviewProject());
    const painted = { ...bundle.prepared, laserSecondPassChain: [] };

    expect(reviewModel(bundle, { prepared: painted }).openFillOmissions).toBeUndefined();
  });
});
