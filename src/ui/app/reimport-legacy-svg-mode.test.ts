import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import type { ImportedSvg } from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { sourceFragmentObjects } from '../state/svg-fragment-mutation';
import { resetStore, svgObj } from '../state/test-helpers';
import { handleReimportSelectedArtwork } from './reimport-selected-artwork';

// The real SVG parser, not a mock: every fragment entry it produces carries the
// Line/Fill mode a fresh import would create. A legacy object (imported before
// fragments existed, so it has no svgImport) must keep the operation it has.

const FILL_ONLY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">' +
  '<path d="M2 2 H18 V18 H2 Z" fill="#000000" /></svg>';

const STROKE_ONLY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">' +
  '<path d="M2 2 H18 V18 H2 Z" fill="none" stroke="#000000" /></svg>';

function platformReturning(svgText: string): PlatformAdapter {
  return {
    pickFilesForOpen: vi.fn(async () => [{ name: 'logo.svg', text: async () => svgText }]),
  } as unknown as PlatformAdapter;
}

async function reimportLegacyObject(svgText: string): Promise<ReturnType<typeof vi.fn>> {
  const target = useStore.getState().project.scene.objects[0] as ImportedSvg;
  const pushToast = vi.fn();
  await handleReimportSelectedArtwork({
    platform: platformReturning(svgText),
    target,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    getTargetObject: () =>
      useStore.getState().project.scene.objects.find((candidate) => candidate.id === target.id),
    reimportObject: useStore.getState().reimportSvgObject,
    reimportFragment: useStore.getState().reimportSvgFragment,
    getSourceObjects: () => sourceFragmentObjects(useStore.getState().project.scene, target),
    pushToast,
  });
  return pushToast;
}

function soleObjectAndOperation() {
  const { layers, objects } = useStore.getState().project.scene;
  expect(objects).toHaveLength(1);
  expect(layers).toHaveLength(1);
  const [object] = objects;
  const [operation] = layers;
  if (object === undefined || operation === undefined) throw new Error('scene is empty');
  return { object, operation };
}

describe('re-importing a legacy SVG object through the real parser', () => {
  beforeEach(resetStore);

  it('keeps a Line operation cutting when the revised file is fill-only', async () => {
    useStore.getState().importSvgObject({ ...svgObj('legacy', ['#000000']), source: 'logo.svg' });
    expect(useStore.getState().project.scene.layers[0]?.mode).toBe('line');

    const pushToast = await reimportLegacyObject(FILL_ONLY_SVG);

    const { object, operation } = soleObjectAndOperation();
    expect(object).toMatchObject({ id: 'legacy', kind: 'imported-svg' });
    // The revised geometry arrived (the closed square), on the same operation.
    expect(object.kind === 'imported-svg' && object.paths[0]?.polylines[0]?.closed).toBe(true);
    expect(object.operationOverride).toBeUndefined();
    expect(operation.mode).toBe('line');
    expect(effectiveOperationForObject(operation, object).mode).toBe('line');
    expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('keeps a Fill operation filling when the revised file is stroke-only', async () => {
    useStore.getState().importSvgObject({ ...svgObj('legacy', ['#000000']), source: 'logo.svg' });
    const [original] = useStore.getState().project.scene.layers;
    if (original === undefined) throw new Error('no operation');
    useStore.getState().setLayerParam(original.id, { mode: 'fill' });

    await reimportLegacyObject(STROKE_ONLY_SVG);

    const { object, operation } = soleObjectAndOperation();
    expect(object.operationOverride).toBeUndefined();
    expect(operation.mode).toBe('fill');
    expect(effectiveOperationForObject(operation, object).mode).toBe('fill');
  });
});
