import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
} from '../core/scene';
import type { Job } from '../core/job/job';
import { parseSvg } from '../io/svg/parse-svg';

export const topologyDevice = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 200,
  bedHeight: 200,
  laserArcMoves: 'off' as const,
};
export const topologyOptimization = {
  travelPolicy: 'nearest-neighbor',
  insideFirst: true,
  layerPriority: 'project-order',
  pathDirection: 'allow-reverse',
  startPoint: 'machine-origin',
  closedShapeStart: 'drawn',
} as const;
export function topologyRectangle(x: number, y: number, width: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + width },
      { x, y: y + width },
    ],
  };
}
export function topologyArtwork(id: string, x: number, size = 10): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id + '.svg',
    operationIds: ['cut'],
    bounds: { minX: x, minY: 10, maxX: x + size, maxY: 10 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [topologyRectangle(x, 10, size)] }],
  };
}
export function topologyProject(objects: ImportedSvg[], layers: Layer[]): Project {
  const base = createProject(topologyDevice);
  return {
    ...base,
    optimization: { ...base.optimization, ...topologyOptimization, reduceTravelMoves: true },
    scene: { objects, layers },
  };
}
export function repeatedPowerProject(): Project {
  const layer = {
    ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }),
    power: 80,
    passes: 2,
    speed: 1200,
  };
  return topologyProject(
    [
      topologyArtwork('A', 10),
      { ...topologyArtwork('B', 40), powerScale: 50 },
      topologyArtwork('C', 70),
    ],
    [layer],
  );
}
export function nativeArcProject(): Project {
  const project = topologyProject(
    [],
    [{ ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }), power: 80, speed: 1200 }],
  );
  const parsed = parseSvg({
    id: 'circle',
    source: 'circle.svg',
    svgText:
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="40" r="10" fill="none" stroke="#000000"/></svg>',
  });
  if (parsed.object === null) throw new Error('Expected native circle fixture');
  return {
    ...project,
    device: { ...project.device, controllerKind: 'grbl-v1.1', laserArcMoves: 'on' },
    scene: {
      ...project.scene,
      objects: [{ ...topologyArtwork('circle', 40, 20), paths: parsed.object.paths }],
    },
  };
}
export function archiveTopologyProject(): Project {
  const layer = {
    ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }),
    power: 80,
    speed: 1200,
    passes: 3,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    tabSkipInnerShapes: false,
    tabCutPowerPercent: 20,
    perforationEnabled: true,
    perforationCutMm: 3,
    perforationSkipMm: 1,
  };
  const plate = topologyArtwork('plate', 10, 80);
  const hole = {
    ...topologyArtwork('hole', 30, 20),
    operationOverride: { byOperation: { cut: { power: 40, speed: 600, passes: 2 } } },
  };
  return topologyProject([plate, hole], [layer]);
}
// A pre-K1 Job already had nesting, source IDs and process settings. It did not
// have topologyScope/topologyContour. Its historically unsafe cross-group order
// remains sealed archive evidence; a current rebuild may order it differently.
export function historicalNestingJob(): Job {
  const layer = {
    ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }),
    power: 80,
    speed: 1200,
    passes: 2,
  };
  const common = {
    layerId: 'cut',
    sourceObjectId: 'plate',
    color: '#000000',
    power: 80,
    speed: 1200,
    passes: 2,
    airAssist: false,
    operationSettings: layer,
  };
  const contour = (x: number, y: number, size: number, depth: number) => ({
    polyline: [...topologyRectangle(x, y, size).points, { x, y }],
    closed: true,
    nesting: { forest: 'pre-k1-path', depth },
  });
  return {
    groups: [
      { ...common, kind: 'cut', segments: [contour(10, 10, 80, 0), contour(30, 30, 10, 2)] },
      {
        ...common,
        kind: 'cut',
        sourceObjectId: 'hole',
        power: 40,
        speed: 600,
        passes: 1,
        operationSettings: { ...layer, power: 40, speed: 600, passes: 1 },
        segments: [contour(20, 20, 50, 1)],
      },
    ],
  };
}

export function mixedOpenProject(): Project {
  const object = topologyArtwork('mixed', 10, 80);
  return topologyProject(
    [
      {
        ...object,
        paths: [
          {
            color: '#000000',
            polylines: [
              topologyRectangle(10, 10, 80),
              {
                closed: false,
                points: [
                  { x: 20, y: 20 },
                  { x: 30, y: 20 },
                ],
              },
              {
                closed: false,
                points: [
                  { x: 110, y: 40 },
                  { x: 100, y: 40 },
                ],
              },
            ],
          },
        ],
      },
    ],
    [{ ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }), power: 80, speed: 1200 }],
  );
}
export function uniformFillProject(): Project {
  return topologyProject(
    [
      topologyArtwork('plate', 10, 80),
      {
        ...topologyArtwork('hole', 30, 20),
        paths: [{ color: '#000000', polylines: [topologyRectangle(30, 30, 20)] }],
      },
    ],
    [
      {
        ...createLayer({ id: 'cut', color: '#000000', mode: 'fill' }),
        power: 80,
        speed: 1200,
        hatchSpacingMm: 10,
        fillOverscanMm: 0,
      },
    ],
  );
}

export function uniformLineProject(): Project {
  const base = repeatedPowerProject();
  return topologyProject(
    [topologyArtwork('A', 10), topologyArtwork('B', 40), topologyArtwork('C', 70)],
    [...base.scene.layers],
  );
}

export function sharedEdgeDrawnProject(): Project {
  const drawn = (id: string, points: { x: number; y: number }[]): ImportedSvg => ({
    ...topologyArtwork(id, 0),
    paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
  });
  const project = topologyProject(
    [
      drawn('A', [
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      drawn('B', [
        { x: 10, y: 20 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 20 },
      ]),
    ],
    [{ ...createLayer({ id: 'cut', color: '#000000', mode: 'line' }), power: 80, speed: 1200 }],
  );
  return { ...project, optimization: { ...project.optimization, removeOverlappingLines: true } };
}
