import { describe, expect, it } from 'vitest';
import { stampFixture } from './stamp-preparation.test-fixture';
import { applyStampDraft, stampDraftImage } from './stamp-preparation-actions';
describe('stamp image acceptance', () => {
  it('preserves originals and group/operation identity while adding one undoable image', () => {
    const { state, owner, source, draft, image, project } = stampFixture();
    const prepared = stampDraftImage(source, draft, 'stamp');
    const patch = applyStampDraft(state, owner, prepared);
    expect(patch.project?.scene.objects[0]).toBe(image);
    expect(patch.project?.scene.groups).toBe(project.scene.groups);
    expect(patch.project?.scene.objects).toHaveLength(2);
    expect(patch.project?.scene.layers).toHaveLength(1);
    expect(patch.undoStack).toEqual([project]);
    expect(prepared.transform).toBe(image.transform);
    expect(prepared.pixelWidth).toBe(image.pixelWidth + draft.paddingX * 2);
    expect(
      (prepared.bounds.maxX - prepared.bounds.minX) * Math.abs(prepared.transform.scaleX),
    ).toBe(draft.widthMm);
    expect(
      (prepared.bounds.maxY - prepared.bounds.minY) * Math.abs(prepared.transform.scaleY),
    ).toBe(draft.heightMm);
    expect(prepared).not.toHaveProperty('imageMaskId');
    expect(prepared).not.toHaveProperty('operationIds');
  });
  it('refuses stale documents, selections and duplicate identity without mutation', () => {
    const { state, owner, source, draft, image } = stampFixture();
    const prepared = stampDraftImage(source, draft, 'stamp');
    expect(applyStampDraft({ ...state, projectDocumentEpoch: 25 }, owner, prepared)).toEqual({});
    expect(applyStampDraft({ ...state, project: { ...state.project } }, owner, prepared)).toEqual(
      {},
    );
    expect(applyStampDraft({ ...state, selectedObjectId: null }, owner, prepared)).toEqual({});
    expect(applyStampDraft(state, owner, { ...prepared, id: image.id })).toEqual({});
  });
});
