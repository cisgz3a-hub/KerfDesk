// ADR-673: a photo kept when tracing (Delete Image After trace unticked) is an
// ordinary image that engraves on its Image operation, as in LightBurn, where
// the customer workflow is engrave the photo, then cut an Offset Shapes outline
// of its trace. These tests drive the real store actions end to end.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileJob, computeFrameBounds, rasterBoundsInMachineCoords } from '../../core/job';
import { maxOutputOverscanMm } from '../../core/preflight/laser-off-motion-policy';
import { runPreflight } from '../../core/preflight/preflight';
import { grblStrategy } from '../../core/output';
import {
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../../core/scene';
import { sortCutsLast } from '../../core/sort-cuts-last';
import { traceSourceForTracedImage } from '../commands/image-command-actions';
import { hoverOutputSettings } from '../workspace/hover-output-settings';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const PHOTO_PIXELS = 4;

function photo(): RasterImage {
  // A uniformly mid-dark photo, so every pixel burns.
  const luma = String.fromCharCode(...new Array<number>(PHOTO_PIXELS * PHOTO_PIXELS).fill(64));
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'portrait.jpg',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: btoa(luma),
    pixelWidth: PHOTO_PIXELS,
    pixelHeight: PHOTO_PIXELS,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40 },
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 5,
  };
}

// The traced silhouette in the photo's pixel grid: a centred square.
function trace(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'portrait.jpg',
    traceMode: 'filled-contours',
    tracePixelWidth: PHOTO_PIXELS,
    tracePixelHeight: PHOTO_PIXELS,
    bounds: { minX: 1, minY: 1, maxX: 3, maxY: 3 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 3, y: 1 },
              { x: 3, y: 3 },
              { x: 1, y: 3 },
            ],
          },
        ],
      },
    ],
  };
}

function sourcesInJob(project: Project): ReadonlyArray<string> {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'raster' ? [group.sourceObjectId ?? 'raster'] : [group.kind],
  );
}

function groupKinds(project: Project): ReadonlyArray<string> {
  return compileJob(project.scene, project.device).groups.map((group) => group.kind);
}

function object(project: Project, id: string): SceneObject {
  const found = project.scene.objects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
}

function traceKeepingPhoto(): Project {
  useStore.getState().importRasterImage(photo());
  useStore.getState().traceExistingImage('photo', trace(), { deleteSourceAfterTrace: false });
  return useStore.getState().project;
}

// The customer's outline: Offset Shapes outward on the trace, outer shapes
// only, deleting the trace, then cut on a Line operation.
function offsetOutlineAsCut(): Project {
  useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set() });
  const applied = useStore.getState().offsetShapesSelection({
    distanceMm: 2,
    direction: 'outward',
    cornerStyle: 'corner',
    outerShapesOnly: true,
    deleteOriginals: true,
  });
  expect(applied).toBe(true);
  const project = useStore.getState().project;
  const outline = project.scene.objects.find((candidate) => candidate.kind === 'imported-svg');
  if (outline === undefined) throw new Error('Offset Shapes added no outline');
  for (const operationId of operationIdsForObject(outline, project.scene.layers)) {
    useStore.getState().setLayerParam(operationId, { mode: 'line' });
  }
  return useStore.getState().project;
}

beforeEach(resetStore);
afterEach(resetStore);

describe('a photo kept when tracing (ADR-673)', () => {
  it('engraves the photo, then cuts the Offset Shapes outline of its trace', () => {
    useStore.getState().importRasterImage(photo());
    expect(groupKinds(useStore.getState().project)).toEqual(['raster']);

    const traced = traceKeepingPhoto();
    expect(groupKinds(traced)).toEqual(['raster', 'fill']);
    expect(object(traced, 'photo')).not.toHaveProperty('role');

    const cut = offsetOutlineAsCut();
    expect(cut.scene.objects.map((candidate) => candidate.id)).not.toContain('trace');
    expect(groupKinds(cut)).toEqual(['raster', 'cut']);
  });

  it('keeps the photo on its own operation and colour, and Re-trace Original finds it', () => {
    useStore.getState().importRasterImage(photo());
    const imported = useStore.getState().project;
    const photoOperation = imported.scene.layers.find((layer) =>
      operationIdsForObject(object(imported, 'photo'), imported.scene.layers).includes(layer.id),
    );
    useStore.getState().traceExistingImage('photo', trace(), { deleteSourceAfterTrace: false });
    const traced = useStore.getState().project;
    const traceObject = object(traced, 'trace');
    const [traceOperationId] = operationIdsForObject(traceObject, traced.scene.layers);

    expect(traced.scene.layers.find((layer) => layer.id === photoOperation?.id)).toEqual(
      photoOperation,
    );
    expect(traceOperationId).not.toBe(photoOperation?.id);
    expect(traceObject).toMatchObject({ kind: 'traced-image', traceSourceId: 'photo' });
    expect(traceSourceForTracedImage(traced, traceObject)?.id).toBe('photo');
  });

  it('frames the photo footprint, not only the outline', () => {
    traceKeepingPhoto();
    const project = offsetOutlineAsCut();
    const frame = computeFrameBounds(project.scene, project.device);
    const photoBounds = rasterBoundsInMachineCoords(
      object(project, 'photo') as RasterImage,
      project.device,
    );

    expect(frame).not.toBeNull();
    expect(frame?.minX).toBeLessThanOrEqual(photoBounds.minX);
    expect(frame?.minY).toBeLessThanOrEqual(photoBounds.minY);
    expect(frame?.maxX).toBeGreaterThanOrEqual(photoBounds.maxX);
    expect(frame?.maxY).toBeGreaterThanOrEqual(photoBounds.maxY);
  });

  it('counts the photo in preflight: image overscan, and a mode mismatch off Image', () => {
    const project = traceKeepingPhoto();
    expect(maxOutputOverscanMm(project.scene, project.device)).toBeGreaterThan(0);
    const gcode = grblStrategy.emit(compileJob(project.scene, project.device), project.device);
    expect(runPreflight(project, gcode).issues.map((issue) => issue.code)).not.toContain(
      'layer-mode-mismatch',
    );

    const [photoOperationId] = operationIdsForObject(
      object(project, 'photo'),
      project.scene.layers,
    );
    if (photoOperationId === undefined) throw new Error('photo has no operation');
    useStore.getState().setLayerParam(photoOperationId, { mode: 'fill' });
    const mismatched = useStore.getState().project;
    const mismatchedGcode = grblStrategy.emit(
      compileJob(mismatched.scene, mismatched.device),
      mismatched.device,
    );
    expect(runPreflight(mismatched, mismatchedGcode).issues.map((issue) => issue.code)).toContain(
      'layer-mode-mismatch',
    );
  });

  it('shows the photo’s own power and speed on hover', () => {
    const project = traceKeepingPhoto();
    expect(hoverOutputSettings(project, object(project, 'photo'))).toMatchObject({
      kind: 'runs',
    });
  });

  it('moves the photo engraving ahead of the outline cut in Sort cuts last', () => {
    traceKeepingPhoto();
    const project = offsetOutlineAsCut();
    const outlineId = project.scene.objects.find(
      (candidate) => candidate.kind === 'imported-svg',
    )?.id;
    if (outlineId === undefined) throw new Error('missing outline');
    const cutFirst = {
      ...project.scene,
      artworkOrder: [outlineId, 'photo'],
    };

    const sorted = sortCutsLast(cutFirst);

    expect(sorted.scene.artworkOrder).toEqual(['photo', outlineId]);
    expect(sorted.artworkMovedLater).toBe(1);
    expect(compileJob(sorted.scene, project.device).groups.map((group) => group.kind)).toEqual([
      'raster',
      'cut',
    ]);
  });

  it('still engraves the photo after the trace is deleted', () => {
    traceKeepingPhoto();
    useStore.getState().removeSceneObject('trace');
    const project = useStore.getState().project;

    expect(project.scene.objects.map((candidate) => candidate.id)).toEqual(['photo']);
    expect(groupKinds(project)).toEqual(['raster']);
  });

  it('duplicates only the trace, which keeps its Re-trace link to the photo', () => {
    traceKeepingPhoto();
    useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set() });
    useStore.getState().duplicateSelection();
    const project = useStore.getState().project;
    const rasters = project.scene.objects.filter((candidate) => candidate.kind === 'raster-image');
    const traces = project.scene.objects.filter((candidate) => candidate.kind === 'traced-image');

    expect(rasters.map((candidate) => candidate.id)).toEqual(['photo']);
    expect(traces).toHaveLength(2);
    expect(
      traces.map((candidate) => 'traceSourceId' in candidate && candidate.traceSourceId),
    ).toEqual(['photo', 'photo']);
    // One photo engraving, not one per copy.
    expect(sourcesInJob(project).filter((source) => source === 'photo')).toHaveLength(1);
  });

  it('copies the photo with the trace only when both are selected', () => {
    traceKeepingPhoto();
    useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set(['photo']) });
    useStore.getState().duplicateSelection();
    const project = useStore.getState().project;
    const copies = project.scene.objects.filter(
      (candidate) => candidate.id !== 'trace' && candidate.id !== 'photo',
    );
    const copiedPhoto = copies.find((candidate) => candidate.kind === 'raster-image');
    const copiedTrace = copies.find((candidate) => candidate.kind === 'traced-image');

    expect(copiedPhoto).toBeDefined();
    expect(copiedTrace).toMatchObject({ traceSourceId: copiedPhoto?.id });
  });

  it('pastes a trace into another project without a link to a photo it lacks', () => {
    traceKeepingPhoto();
    useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set() });
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard();
    const sameDocument = useStore
      .getState()
      .project.scene.objects.filter((candidate) => candidate.kind === 'traced-image');
    expect(
      sameDocument.map((candidate) => 'traceSourceId' in candidate && candidate.traceSourceId),
    ).toEqual(['photo', 'photo']);

    const clipboard = useStore.getState().sceneClipboard;
    resetStore();
    useStore.setState({ sceneClipboard: clipboard, projectDocumentEpoch: 1 });
    useStore.getState().pasteClipboard();
    const pasted = useStore.getState().project.scene.objects;

    expect(pasted.map((candidate) => candidate.kind)).toEqual(['traced-image']);
    expect(pasted[0]).not.toHaveProperty('traceSourceId');
  });

  it('burns a Raster scan trace on its own copy of the photo operation, kept on re-trace', () => {
    useStore.getState().importRasterImage(photo());
    const bitmap: RasterImage = { ...photo(), id: 'trace-bitmap', source: 'portrait.jpg (trace)' };
    useStore.getState().commitRasterizedTrace('photo', bitmap, { deleteSourceAfterTrace: false });
    const first = useStore.getState().project;
    const [photoOperation] = operationIdsForObject(object(first, 'photo'), first.scene.layers);
    const resultOperations = operationIdsForObject(
      object(first, 'trace-bitmap'),
      first.scene.layers,
    );

    expect(resultOperations).toHaveLength(1);
    expect(resultOperations).not.toContain(photoOperation);
    useStore.getState().setLayerParam(photoOperation ?? '', { output: false });
    expect(sourcesInJob(useStore.getState().project)).toEqual(['trace-bitmap']);

    useStore.getState().commitRasterizedTrace('photo', bitmap, {
      deleteSourceAfterTrace: false,
      replaceTraceId: bitmap.id,
    });
    const again = useStore.getState().project;
    expect(operationIdsForObject(object(again, 'trace-bitmap'), again.scene.layers)).toEqual(
      resultOperations,
    );
    expect(again.scene.layers).toHaveLength(first.scene.layers.length);
  });
});
