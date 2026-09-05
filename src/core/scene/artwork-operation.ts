import {
  cloneLayerSubLayers,
  createLayer,
  layerSubLayerOperationId,
  type Layer,
  type LayerMode,
  type LayerSubLayer,
} from './layer';
import { bindSceneObjectToOperations } from './operation-binding';
import type { Scene } from './scene';
import type { SceneObject } from './scene-object';
import { effectiveOperationForObject } from '../effective-output';

// New artwork starts in black; later operations receive distinct colors in
// this stable order so the canvas stays readable as the design grows.
const OPERATION_PALETTE = [
  '#000000',
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#c026d3',
  '#65a30d',
  '#4f46e5',
  '#d97706',
  '#0f766e',
  '#be123c',
] as const;

export type ArtworkOperationResult = {
  readonly object: SceneObject;
  readonly operation: Layer;
};

export type ArtworkOperationsResult = {
  readonly object: SceneObject;
  readonly operations: ReadonlyArray<Layer>;
};

export function createArtworkOperation(
  scene: Scene,
  object: SceneObject,
  options: {
    readonly mode?: LayerMode;
    readonly name?: string;
    readonly subLayers?: ReadonlyArray<LayerSubLayer>;
  } = {},
): ArtworkOperationResult {
  const id = nextOperationId(scene.layers, object.id, options.subLayers ?? []);
  const name = uniqueOperationName(
    scene.layers,
    options.name?.trim() || artworkOperationName(object),
  );
  const base = {
    ...createLayer({
      id,
      name,
      color: nextOperationColor(scene.layers),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    }),
    subLayers: cloneLayerSubLayers(options.subLayers ?? []),
  };
  const operation = effectiveOperationForObject(base, object);
  const bound = bindSceneObjectToOperations(object, [id]);
  if (bound.operationOverride === undefined) return { object: bound, operation };
  const { operationOverride: _operationOverride, ...withoutOverride } = bound;
  return { object: withoutOverride as SceneObject, operation };
}

export function createArtworkOperations(
  scene: Scene,
  object: SceneObject,
  options: { readonly mode?: LayerMode; readonly name?: string } = {},
): ArtworkOperationsResult {
  if (!('paths' in object)) {
    const created = createArtworkOperation(scene, object, options);
    return { object: created.object, operations: [created.operation] };
  }
  const colors = [...new Set(object.paths.map((path) => path.color.toLowerCase()))];
  if (colors.length <= 1) {
    const created = createArtworkOperation(scene, object, options);
    return { object: created.object, operations: [created.operation] };
  }
  const baseName = options.name?.trim() || artworkOperationName(object);
  const operations: Layer[] = [];
  const operationIdByColor = new Map<string, string>();
  let workingScene = scene;
  colors.forEach((color, index) => {
    const created = createArtworkOperation(workingScene, object, {
      ...options,
      name: `${baseName} ${index + 1}`,
    });
    operations.push(created.operation);
    operationIdByColor.set(color, created.operation.id);
    workingScene = { ...workingScene, layers: [...workingScene.layers, created.operation] };
  });
  const clean = withoutOperationOverride(object);
  return {
    object: {
      ...clean,
      paths: clean.paths.map((path) => {
        const operationId = operationIdByColor.get(path.color.toLowerCase());
        return operationId === undefined ? path : { ...path, operationIds: [operationId] };
      }),
    } as SceneObject,
    operations,
  };
}

export function artworkOperationName(object: SceneObject): string {
  switch (object.kind) {
    case 'text':
      return cleanName(object.content, 'Text');
    case 'shape':
      return shapeName(object.spec.kind);
    case 'imported-svg':
    case 'traced-image':
    case 'raster-image':
    case 'relief':
      return cleanName(fileStem(object.source), 'Artwork');
    default:
      return object satisfies never;
  }
}

export function nextOperationColor(operations: ReadonlyArray<Pick<Layer, 'color'>>): string {
  const used = new Set(operations.map((operation) => operation.color.toLowerCase()));
  const paletteColor = OPERATION_PALETTE.find((color) => !used.has(color));
  if (paletteColor !== undefined) return paletteColor;
  for (let index = 0; index < 360; index += 1) {
    const color = hslToHex((7 + index * 37) % 360, 70, 42);
    if (!used.has(color)) return color;
  }
  // Valid projects contain at most 256 operations. The RGB scan is a
  // deterministic collision-free fallback even when every palette/hue color
  // is already present (including imported legacy aliases).
  for (let rgb = 0; rgb <= 0xffffff; rgb += 1) {
    const color = `#${rgb.toString(16).padStart(6, '0')}`;
    if (!used.has(color)) return color;
  }
  return '#475569';
}

function nextOperationId(
  operations: ReadonlyArray<Layer>,
  objectId: string,
  subLayers: ReadonlyArray<LayerSubLayer>,
): string {
  const base = `operation-${objectId}`;
  const used = new Set(
    operations.flatMap((operation) => [
      operation.id,
      ...operation.subLayers.map((sub) => layerSubLayerOperationId(operation.id, sub.id)),
    ]),
  );
  const available = (id: string): boolean =>
    !used.has(id) && subLayers.every((sub) => !used.has(layerSubLayerOperationId(id, sub.id)));
  if (available(base)) return base;
  let suffix = 2;
  while (!available(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function uniqueOperationName(operations: ReadonlyArray<Layer>, requested: string): string {
  const used = new Set(operations.map((operation) => operation.name.toLocaleLowerCase()));
  if (!used.has(requested.toLocaleLowerCase())) return requested;
  let suffix = 2;
  while (used.has(`${requested} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${requested} ${suffix}`;
}

function fileStem(source: string): string {
  const fileName = source.replaceAll('\\', '/').split('/').at(-1) ?? source;
  return fileName.replace(/\.[^.]+$/, '');
}

function cleanName(value: string, fallback: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length === 0) return fallback;
  return compact.length <= 32 ? compact : `${compact.slice(0, 29)}...`;
}

function shapeName(kind: string): string {
  if (kind === 'rect') return 'Rectangle';
  if (kind === 'ellipse') return 'Ellipse';
  if (kind === 'polygon') return 'Polygon';
  if (kind === 'star') return 'Star';
  return 'Polyline';
}

function withoutOperationOverride<T extends SceneObject>(object: T): T {
  if (object.operationOverride === undefined) return object;
  const { operationOverride: _operationOverride, ...rest } = object;
  return rest as T;
}

function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const channels =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${channels
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
