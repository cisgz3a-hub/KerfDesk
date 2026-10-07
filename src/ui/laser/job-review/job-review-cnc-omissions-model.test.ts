import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCncOmissionReview,
  cncReviewModel,
  cncReviewProject,
  prepareCncOmissionReview,
  resetCncOmissionReview,
} from '../../../__fixtures__/cnc-omission-review';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
  cncOmissionArtwork,
} from '../../../__fixtures__/cnc-open-contours';
import { DEFAULT_OUTPUT_SCOPE } from '../../../core/scene';
import { useStore } from '../../state/store';
import { matchingReviewArtworkIds } from './review-artwork-sources';

beforeEach(() => resetCncOmissionReview());
afterEach(() => clearCncOmissionReview());

describe('C1 source-owned CNC omission metadata in real Job Review', () => {
  it('uses the actual prepared project rather than foreign artwork on the current canvas', async () => {
    const bundle = await prepareCncOmissionReview();
    const foreign = cncReviewProject([
      CNC_OMISSION_CLOSED,
      cncOmissionArtwork('foreign-open', false, 100),
    ]);
    useStore.setState({ project: foreign });
    const model = cncReviewModel(bundle, { project: foreign });
    expect(model.openCncContourOmissions).toMatchObject({
      objectIds: [CNC_OMISSION_OPEN_A.id, CNC_OMISSION_OPEN_B.id],
      contourCount: 2,
    });
    expect(useStore.getState().project).toBe(foreign);
    expect(bundle.prepared.gcode).toMatch(/^G1 /m);
  });

  it('binds repair IDs to the real prepared selected-artwork scope', async () => {
    const scope = {
      ...DEFAULT_OUTPUT_SCOPE,
      cutSelectedGraphics: true,
      selectedObjectIds: [CNC_OMISSION_CLOSED.id, CNC_OMISSION_OPEN_A.id],
    };
    const bundle = await prepareCncOmissionReview(cncReviewProject(), scope);
    const model = cncReviewModel(bundle);
    expect(model.openCncContourOmissions).toMatchObject({
      objectIds: [CNC_OMISSION_OPEN_A.id],
      contourCount: 1,
    });
    expect(bundle.outputScope).toEqual(scope);
    const sources = model.openCncContourOmissions?.sources;
    expect(sources).toBeDefined();
    expect(
      matchingReviewArtworkIds(sources ?? [], bundle.prepared.prepared.project.scene.objects),
    ).toEqual([CNC_OMISSION_OPEN_A.id]);
  });

  it('retains correspondence across worker-style clones without accepting a reused-ID edit', async () => {
    const bundle = await prepareCncOmissionReview();
    const model = cncReviewModel({
      ...bundle,
      prepared: {
        ...bundle.prepared,
        prepared: structuredClone(bundle.prepared.prepared),
      },
    });
    const sources = model.openCncContourOmissions?.sources;
    expect(sources).toBeDefined();
    const changed = bundle.project.scene.objects.map((object) =>
      object.id === CNC_OMISSION_OPEN_B.id
        ? { ...object, transform: { ...object.transform, x: object.transform.x + 80 } }
        : object,
    );
    expect(matchingReviewArtworkIds(sources ?? [], changed)).toEqual([CNC_OMISSION_OPEN_A.id]);
  });

  it('keeps archived exact omission advice without deriving current-canvas repair IDs', async () => {
    const bundle = await prepareCncOmissionReview();
    const archived = {
      ...bundle.prepared,
      prepared: structuredClone(bundle.prepared.prepared),
      laserResumeChain: [],
    };
    const model = cncReviewModel(bundle, { prepared: archived });
    expect(model.warnings.some((warning) => /\b2\b.*open|open.*\b2\b/i.test(warning))).toBe(true);
    expect(model.openCncContourOmissions).toBeUndefined();
  });

  it('control: a closed-only CNC preparation has no omitted-artwork navigation data', async () => {
    const bundle = await prepareCncOmissionReview(cncReviewProject([CNC_OMISSION_CLOSED]));
    expect(bundle.prepared.gcode).toMatch(/^G1 /m);
    expect(cncReviewModel(bundle).openCncContourOmissions).toBeUndefined();
  });

  it('control: successful profile and engraving preparations have no omission metadata', async () => {
    for (const cutType of ['profile-on-path', 'engrave'] as const) {
      const bundle = await prepareCncOmissionReview(
        cncReviewProject([CNC_OMISSION_OPEN_A, CNC_OMISSION_OPEN_B], cutType),
      );
      expect(bundle.prepared.gcode).toMatch(/^G1 /m);
      expect(cncReviewModel(bundle).openCncContourOmissions).toBeUndefined();
    }
  });
});
