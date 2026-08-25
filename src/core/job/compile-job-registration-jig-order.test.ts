import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createRegistrationBox } from '../shapes';
import {
  createLayer,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type Scene,
  type SceneObject,
} from '../scene';
import { registrationJigCopyId } from '../scene/registration-jig-artwork';
import { compileJob } from './compile-job';
import { buildToolpath } from './toolpath';

describe('registration jig artwork compilation order', () => {
  it('finishes every operation for one jig before starting the next jig', () => {
    const first = fillOperation('first-op', '#2563eb');
    const second = fillOperation('second-op', '#dc2626');
    const source = artwork('art', [first.id, second.id], 0);
    const scene = jigScene([first, second], source, [
      { boxId: 'box-b', x: 50 },
      { boxId: 'box-c', x: 100 },
      { boxId: 'box-d', x: 150 },
    ]);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(job.groups.map((group) => [group.sourceObjectId, group.layerId])).toEqual([
      ['art', 'first-op'],
      ['art', 'second-op'],
      [registrationJigCopyId('art', 'box-b'), 'first-op'],
      [registrationJigCopyId('art', 'box-b'), 'second-op'],
      [registrationJigCopyId('art', 'box-c'), 'first-op'],
      [registrationJigCopyId('art', 'box-c'), 'second-op'],
      [registrationJigCopyId('art', 'box-d'), 'first-op'],
      [registrationJigCopyId('art', 'box-d'), 'second-op'],
    ]);
  });

  it('keeps each jig scanline fill inside its own group', () => {
    const fill = fillOperation('fill', '#2563eb');
    const source = artwork('art', [fill.id], 0);
    const scene = jigScene([fill], source, [
      { boxId: 'box-b', x: 50 },
      { boxId: 'box-c', x: 100 },
      { boxId: 'box-d', x: 150 },
    ]);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(job.groups).toHaveLength(4);
    for (const [index, group] of job.groups.entries()) {
      if (group.kind !== 'fill') throw new Error('expected one fill group per jig');
      const xs = group.segments.flatMap((segment) => segment.polyline.map((point) => point.x));
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(10.001);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(index * 50 - 0.001);
      expect(Math.max(...xs)).toBeLessThanOrEqual(index * 50 + 10.001);
    }
  });

  it('finishes each raster image before starting the next jig copy', () => {
    const image = imageOperation('image');
    const source = rasterArtwork('photo', image.id, 0);
    const scene = jigScene([image], source, [
      { boxId: 'box-b', x: 50 },
      { boxId: 'box-c', x: 100 },
      { boxId: 'box-d', x: 150 },
    ]);

    const job = compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(job.groups.map((group) => [group.kind, group.sourceObjectId])).toEqual([
      ['raster', 'photo'],
      ['raster', registrationJigCopyId('photo', 'box-b')],
      ['raster', registrationJigCopyId('photo', 'box-c')],
      ['raster', registrationJigCopyId('photo', 'box-d')],
    ]);
  });

  it('eliminates repeated cross-jig scan travel for separated fill artwork', () => {
    const fill = fillOperation('fill', '#2563eb');
    const source = artwork('art', [fill.id], 0);
    const scene = jigScene([fill], source, [
      { boxId: 'box-b', x: 50 },
      { boxId: 'box-c', x: 100 },
      { boxId: 'box-d', x: 150 },
    ]);
    const ordinaryScene = {
      ...scene,
      objects: scene.objects.map((object, index) =>
        object.id.startsWith('registration-jig-copy:')
          ? { ...object, id: `ordinary-copy-${index}` }
          : object,
      ),
    };

    const pieceCompleteTravel = travelLength(
      buildToolpath(compileJob(scene, DEFAULT_DEVICE_PROFILE)),
    );
    const crossJigTravel = travelLength(
      buildToolpath(compileJob(ordinaryScene, DEFAULT_DEVICE_PROFILE)),
    );

    expect(pieceCompleteTravel).toBeLessThan(crossJigTravel);
  });

  it('leaves ordinary artwork sharing one operation as one machining unit', () => {
    const fill = fillOperation('fill', '#2563eb');
    const first = artwork('first', [fill.id], 0);
    const second = artwork('second', [fill.id], 50);

    const job = compileJob({ objects: [first, second], layers: [fill] }, DEFAULT_DEVICE_PROFILE);

    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]?.sourceObjectId).toBe('first');
  });
});

function jigScene(
  operations: ReadonlyArray<Layer>,
  source: SceneObject,
  copies: ReadonlyArray<{ readonly boxId: string; readonly x: number }>,
): Scene {
  const boxes = [
    createRegistrationBox({ id: 'box-a', widthMm: 40, heightMm: 30 }),
    ...copies.map(({ boxId, x }) =>
      createRegistrationBox({ id: boxId, widthMm: 40, heightMm: 30, x }),
    ),
  ];
  const artworkCopies = copies.map(({ boxId, x }) => ({
    ...source,
    id: registrationJigCopyId(source.id, boxId),
    transform: { ...source.transform, x },
  }));
  return {
    objects: [...boxes, source, ...artworkCopies],
    layers: [{ ...createRegistrationLayer(), output: false }, ...operations],
  };
}

function fillOperation(id: string, color: string): Layer {
  return {
    ...createLayer({ id, color, mode: 'fill' }),
    fillStyle: 'scanline',
    hatchSpacingMm: 1,
  };
}

function imageOperation(id: string): Layer {
  return {
    ...createLayer({ id, color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
  };
}

function rasterArtwork(id: string, operationId: string, x: number): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    lumaBase64: 'AP//AA==',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x },
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    operationIds: [operationId],
  };
}

function artwork(id: string, operationIds: ReadonlyArray<string>, x: number): SceneObject {
  return {
    kind: 'shape',
    id,
    color: '#000000',
    operationIds,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    paths: [
      {
        color: '#000000',
        operationIds,
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
            closed: true,
          },
        ],
      },
    ],
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
  };
}

function travelLength(toolpath: ReturnType<typeof buildToolpath>): number {
  return toolpath.steps
    .filter((step) => step.kind === 'travel')
    .reduce((total, step) => total + step.length, 0);
}
