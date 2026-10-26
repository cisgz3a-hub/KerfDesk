import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type RasterImage,
  type Scene,
  type SceneObject,
  type TracedImage,
} from '../../../core/scene';
import { registrationJigObjectIdentity } from '../../../core/scene/registration-jig-artwork';
import { useStore } from '../../state/store';
import { resetStore, svgObj } from '../../state/test-helpers';
import { positionTraceOverRasterSource } from '../../state/trace-placement';
import { importJigArtwork, traceJigImage } from './jig-editor-artwork';
import {
  centerJigArtwork,
  createJigEditorSession,
  replaceJigLayout,
  selectJigObjects,
  type JigEditorSession,
} from './jig-editor-session';
import { jigImageTraceTargets, jigTraceableImage } from './jig-image-trace';

const GRID = {
  outline: { kind: 'rectangle' as const, widthMm: 50, heightMm: 30 },
  rows: 1,
  columns: 3,
  spacingX: 5,
  spacingY: 5,
};

const image: RasterImage = {
  kind: 'raster-image',
  id: 'candles',
  source: 'candles.jpg',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 40,
  pixelHeight: 30,
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
  transform: IDENTITY_TRANSFORM,
  color: '#123456',
  dither: 'threshold',
  linesPerMm: 10,
};

const traced: TracedImage = {
  kind: 'traced-image',
  id: 'trace',
  source: 'candles.jpg',
  traceMode: 'filled-contours',
  tracePixelWidth: 20,
  tracePixelHeight: 15,
  bounds: { minX: 2, minY: 2, maxX: 18, maxY: 13 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 18, y: 2 },
            { x: 18, y: 13 },
          ],
        },
      ],
    },
  ],
};

function object(scene: Scene, id: string): SceneObject {
  const found = scene.objects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing ${id}`);
  return found;
}

function operationId(scene: Scene, id: string): string | undefined {
  return primaryOperationForObject(object(scene, id), scene.layers)?.id;
}

/** Image fitted into the first of three outlines, then centred and copied to all. */
function copiedImageSession(): JigEditorSession {
  let session = replaceJigLayout(createJigEditorSession(useStore.getState()), GRID);
  session = importJigArtwork(session, image);
  session = selectJigObjects(session, new Set([image.id]));
  return centerJigArtwork(session);
}

describe('tracing an image already on the jig', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
  });

  it('replaces the image and its outline copies, each trace lying over its bitmap', () => {
    const before = copiedImageSession();
    const scene = before.draft.project.scene;
    const targets = jigImageTraceTargets(scene, image.id)!;
    expect(targets.copies).toHaveLength(2);
    const imageOperation = operationId(scene, image.id);
    const order = scene.objects.map((item) => item.id);

    const after = traceJigImage(before, image.id, traced);
    const result = after.draft.project.scene;

    expect(result.objects.some((item) => item.kind === 'raster-image')).toBe(false);
    expect(result.layers.some((layer) => layer.id === imageOperation)).toBe(false);
    const trace = object(result, traced.id);
    expect(trace.transform).toEqual(positionTraceOverRasterSource(targets.image, traced).transform);
    // The trace takes the image's stacking slot, and is the only selection.
    expect(result.objects.findIndex((item) => item.id === traced.id)).toBe(order.indexOf(image.id));
    expect(after.draft.selectedObjectId).toBe(traced.id);
    expect(after.draft.additionalSelectedIds.size).toBe(0);

    const boxes = findRegistrationBoxes(result).map((box) => box.id);
    expect(registrationJigObjectIdentity(trace)?.boxId).toBe(boxes[0]);
    for (const copy of targets.copies) {
      const replacement = result.objects[order.indexOf(copy.id)]!;
      const identity = registrationJigObjectIdentity(replacement);
      expect(replacement.kind).toBe('traced-image');
      expect(identity?.ancestors[0]).toEqual({ sourceId: traced.id, kind: 'copy' });
      expect(identity?.boxId).toBe(registrationJigObjectIdentity(copy)?.boxId);
      expect(replacement.transform).toEqual(positionTraceOverRasterSource(copy, traced).transform);
      expect(operationId(result, replacement.id)).toBe(operationId(result, traced.id));
    }
    expect(after.past).toHaveLength(before.past.length + 1);
  });

  it('keeps the traced copies linked, so Centre + copy refreshes them instead of adding more', () => {
    const traced1 = traceJigImage(copiedImageSession(), image.id, traced);
    const recentred = centerJigArtwork(traced1);
    const traces = recentred.draft.project.scene.objects.filter(
      (item) => item.kind === 'traced-image',
    );
    expect(traces).toHaveLength(3);
  });

  it('traces the whole set when one of the copies is the selected image', () => {
    const before = copiedImageSession();
    const copy = jigImageTraceTargets(before.draft.project.scene, image.id)!.copies[1]!;
    expect(jigImageTraceTargets(before.draft.project.scene, copy.id)?.image.id).toBe(image.id);
    const result = traceJigImage(before, copy.id, traced).draft.project.scene;
    expect(result.objects.filter((item) => item.kind === 'traced-image')).toHaveLength(3);
    expect(result.objects.some((item) => item.kind === 'raster-image')).toBe(false);
  });

  it('carries the image place in groups, run order and the design tree over to the trace', () => {
    let session = importJigArtwork(createJigEditorSession(useStore.getState()), image);
    session = importJigArtwork(session, svgObj('label', ['#ff0000']));
    const scene = session.draft.project.scene;
    session = {
      ...session,
      draft: {
        ...session.draft,
        project: {
          ...session.draft.project,
          scene: {
            ...scene,
            groups: [{ id: 'set', name: 'Set', objectIds: [image.id, 'label'] }],
            artworkOrder: [image.id, 'label'],
            designTreeOrder: [
              { kind: 'object', id: 'label' },
              { kind: 'object', id: image.id },
            ],
          },
        },
      },
    };
    const result = traceJigImage(session, image.id, traced).draft.project.scene;
    expect(result.groups).toEqual([{ id: 'set', name: 'Set', objectIds: [traced.id, 'label'] }]);
    expect(result.artworkOrder).toEqual([traced.id, 'label']);
    expect(result.designTreeOrder).toEqual([
      { kind: 'object', id: 'label' },
      { kind: 'object', id: traced.id },
    ]);
  });

  it('leaves the session alone when the image is gone', () => {
    const session = createJigEditorSession(useStore.getState());
    expect(traceJigImage(session, image.id, traced)).toBe(session);
  });
});

describe('the image the jig tracer offers', () => {
  beforeEach(() => resetStore());

  it('is the one selected, unlocked bitmap that is not a trace backing', () => {
    const session = importJigArtwork(createJigEditorSession(useStore.getState()), image);
    const scene = session.draft.project.scene;
    const placed = object(scene, image.id);
    expect(jigTraceableImage(scene, new Set([image.id]))).toBe(placed);
    expect(jigTraceableImage(scene, new Set())).toBeNull();
    const box = findRegistrationBoxes(scene)[0]!.id;
    expect(jigTraceableImage(scene, new Set([image.id, box]))).toBeNull();
    expect(jigTraceableImage(scene, new Set([box]))).toBeNull();
    const swap = (patch: Partial<RasterImage>): Scene => ({
      ...scene,
      objects: scene.objects.map((item) =>
        item.id === image.id ? ({ ...item, ...patch } as SceneObject) : item,
      ),
    });
    expect(jigTraceableImage(swap({ locked: true }), new Set([image.id]))).toBeNull();
  });
});
