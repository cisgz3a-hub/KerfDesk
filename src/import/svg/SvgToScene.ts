/**
 * === FILE: /src/import/svg/SvgToScene.ts ===
 *
 * Purpose:    Convert parsed SVG elements into SceneObjects and
 *             assemble a complete Scene. Each SVG element becomes
 *             one SceneObject with the accumulated group transform
 *             baked into its transform matrix.
 *
 *             Conversion rules:
 *             - rect        → SceneObject with RectGeometry
 *             - circle      → SceneObject with EllipseGeometry (rx = ry = r)
 *             - ellipse     → SceneObject with EllipseGeometry
 *             - line        → SceneObject with LineGeometry
 *             - polyline    → SceneObject with PolygonGeometry (open)
 *             - polygon     → SceneObject with PolygonGeometry (closed)
 *             - path        → SceneObject with PathGeometry
 *
 * Dependencies:
 *   - /src/core/types.ts
 *   - /src/core/scene/Scene.ts
 *   - /src/core/scene/SceneObject.ts
 *   - /src/core/scene/Layer.ts
 *   - /src/import/svg/SvgParser.ts
 *   - /src/import/svg/PathParser.ts
 * Last updated: SVG Import feature
 */

import { type Point, generateId, IDENTITY_MATRIX } from '../../core/types';
import { type Scene, createScene } from '../../core/scene/Scene';
import {
  type SceneObject,
  type Geometry,
} from '../../core/scene/SceneObject';
import { type Layer, createLayer } from '../../core/scene/Layer';
import { type SvgElement, parseSvg } from './SvgParser';
import { parsePathData } from './PathParser';
import { computeSceneBounds } from '../../geometry/bounds';
import {
  type ImportOptions,
  computeImportTransform,
  applyTransformToObjects,
} from '../../io/SvgImportPlacement';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Import an SVG string as a new Scene.
 *
 * @param svgString  Raw SVG file content
 * @param name       Project name (defaults to 'SVG Import')
 * @returns          A new Scene containing all imported objects
 */
export function importSvgToScene(
  svgString: string,
  name: string = 'SVG Import'
): Scene {
  const parsed = parseSvg(svgString);

  // Canvas size comes from unit-converted dimensions
  const scene = createScene(parsed.widthMm, parsed.heightMm, name);

  // Create default layers for common operations
  const cutLayer = scene.layers[0]; // Default layer is 'cut'

  // Convert each SVG element to a SceneObject
  const objects: SceneObject[] = [];
  for (const el of parsed.elements) {
    const layerId = resolveLayerId(el, cutLayer.id);
    const obj = convertElement(el, layerId);
    if (obj) objects.push(obj);
  }

  return { ...scene, objects };
}

/**
 * Import SVG elements into an existing Scene on a specified layer.
 * Optionally positions and scales imported content via ImportOptions.
 *
 * @param svgString  Raw SVG content
 * @param scene      Existing scene to import into
 * @param layerId    Target layer for imported objects
 * @param options    Placement options (mode, target bounds, padding)
 * @returns          New Scene with imported objects appended
 */
export function importSvgIntoScene(
  svgString: string,
  scene: Scene,
  layerId: string,
  options?: Partial<ImportOptions>
): Scene {
  const parsed = parseSvg(svgString);

  // Convert SVG elements to SceneObjects
  let objects: SceneObject[] = [];
  for (const el of parsed.elements) {
    const obj = convertElement(el, layerId);
    if (obj) objects.push(obj);
  }

  if (objects.length === 0) return scene;

  // Apply placement if options provided
  if (options) {
    // Build a temporary scene to compute imported content bounds
    const tempScene: Scene = {
      ...scene,
      objects,
      layers: scene.layers,
    };
    const sourceBounds = computeSceneBounds(tempScene);

    // Default target: scene canvas
    const targetBounds = options.targetBounds ?? {
      minX: 0, minY: 0,
      maxX: scene.canvas.width,
      maxY: scene.canvas.height,
    };

    const importTransform = computeImportTransform(
      sourceBounds, targetBounds, options
    );

    objects = applyTransformToObjects(objects, importTransform);
  }

  return {
    ...scene,
    objects: [...scene.objects, ...objects],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

// ─── LAYER RESOLUTION ────────────────────────────────────────────

/**
 * Determine which layer an SVG element should go on based on its
 * stroke/fill attributes. For now: everything goes to the default layer.
 *
 * Future: color-based layer mapping (LightBurn-style):
 *   - Elements with fill → engrave layer
 *   - Elements with stroke only → cut layer
 *   - Color grouping → separate layers per color
 *
 * The SVG stroke/fill values are preserved in the element's attrs
 * and can be used for this mapping when layer management is wired.
 */
function resolveLayerId(el: SvgElement, defaultLayerId: string): string {
  // Future hooks:
  // const fill = el.attrs['fill'];
  // const stroke = el.attrs['stroke'];
  // if (fill && fill !== 'none') return engraveLayerId;
  // if (stroke && stroke !== 'none') return cutLayerId;
  return defaultLayerId;
}

// ─── ELEMENT CONVERSION ──────────────────────────────────────────

function convertElement(
  el: SvgElement,
  layerId: string
): SceneObject | null {
  const geometry = convertGeometry(el);
  if (!geometry) return null;

  const typeName = el.tag === 'circle' ? 'ellipse'
    : el.tag === 'polyline' ? 'polygon'
    : el.tag as SceneObject['type'];

  return {
    id: generateId(),
    type: typeName,
    name: el.attrs['id'] || el.attrs['inkscape:label'] || capitalize(el.tag),
    layerId,
    parentId: null,
    transform: el.worldTransform,
    geometry,
    visible: true,
    locked: false,
    _bounds: null,
    _worldTransform: null,
  };
}

// ─── GEOMETRY CONVERSION ─────────────────────────────────────────

function convertGeometry(el: SvgElement): Geometry | null {
  switch (el.tag) {
    case 'rect':     return convertRect(el.attrs);
    case 'circle':   return convertCircle(el.attrs);
    case 'ellipse':  return convertEllipse(el.attrs);
    case 'line':     return convertLine(el.attrs);
    case 'polyline': return convertPolyline(el.attrs, false);
    case 'polygon':  return convertPolyline(el.attrs, true);
    case 'path':     return convertPath(el.attrs);
    default:         return null;
  }
}

// ─── RECT ────────────────────────────────────────────────────────

function convertRect(attrs: Record<string, string>): Geometry {
  const x = num(attrs['x']);
  const y = num(attrs['y']);
  const width = num(attrs['width']);
  const height = num(attrs['height']);
  const rx = num(attrs['rx']);
  const ry = num(attrs['ry']);
  const cornerRadius = rx || ry || 0;

  return {
    type: 'rect',
    x, y, width, height,
    cornerRadius,
  };
}

// ─── CIRCLE ──────────────────────────────────────────────────────

function convertCircle(attrs: Record<string, string>): Geometry {
  const cx = num(attrs['cx']);
  const cy = num(attrs['cy']);
  const r = num(attrs['r']);

  return {
    type: 'ellipse',
    cx, cy, rx: r, ry: r,
  };
}

// ─── ELLIPSE ─────────────────────────────────────────────────────

function convertEllipse(attrs: Record<string, string>): Geometry {
  return {
    type: 'ellipse',
    cx: num(attrs['cx']),
    cy: num(attrs['cy']),
    rx: num(attrs['rx']),
    ry: num(attrs['ry']),
  };
}

// ─── LINE ────────────────────────────────────────────────────────

function convertLine(attrs: Record<string, string>): Geometry {
  return {
    type: 'line',
    x1: num(attrs['x1']),
    y1: num(attrs['y1']),
    x2: num(attrs['x2']),
    y2: num(attrs['y2']),
  };
}

// ─── POLYLINE / POLYGON ──────────────────────────────────────────

function convertPolyline(attrs: Record<string, string>, closed: boolean): Geometry | null {
  const pointsStr = attrs['points'];
  if (!pointsStr) return null;

  const numbers = pointsStr
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(n => !isNaN(n));

  if (numbers.length < 4) return null; // Need at least 2 points

  const points: Point[] = [];
  for (let i = 0; i < numbers.length - 1; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }

  return { type: 'polygon', points, closed };
}

// ─── PATH ────────────────────────────────────────────────────────

function convertPath(attrs: Record<string, string>): Geometry | null {
  const d = attrs['d'];
  if (!d) return null;
  return parsePathData(d);
}

// ─── HELPERS ─────────────────────────────────────────────────────

function num(val: string | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
