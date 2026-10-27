// A project as builds up to 1.0.27 saved it after Trace kept the picture: the
// picture carries `role: 'trace-source'`, which left it out of every job
// (ADR-673 and its Amendment 1).
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
} from '../core/scene';
import { serializeProject } from '../io/project/serialize-project';

export const legacyPhoto: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'portrait.jpg',
  dataUrl: 'data:image/png;base64,AAAA',
  lumaBase64: 'QEBAQA==',
  pixelWidth: 2,
  pixelHeight: 2,
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'floyd-steinberg',
  linesPerMm: 5,
  operationIds: ['photo-operation'],
};

export const legacyTrace: TracedImage = {
  kind: 'traced-image',
  id: 'trace',
  source: 'portrait.jpg',
  traceSourceId: 'photo',
  traceMode: 'filled-contours',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  operationIds: ['trace-operation'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 },
          ],
        },
      ],
    },
  ],
};

/** The saved project text, with every object in `tagged` marked as a kept picture. */
export function legacyTraceDocument(
  objects: ReadonlyArray<SceneObject> = [legacyPhoto, legacyTrace],
  tagged: ReadonlyArray<string> = [legacyPhoto.id],
): string {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [...objects],
      layers: [
        createLayer({ id: 'photo-operation', color: '#808080', mode: 'image' }),
        createLayer({ id: 'trace-operation', color: '#000000', mode: 'line' }),
      ],
      groups: [],
      artworkOrder: objects.map((object) => object.id),
    },
  };
  const json = JSON.parse(serializeProject(project)) as {
    scene: { objects: Array<Record<string, unknown>> };
  };
  for (const saved of json.scene.objects) {
    if (tagged.includes(String(saved['id']))) saved['role'] = 'trace-source';
  }
  return JSON.stringify(json);
}
