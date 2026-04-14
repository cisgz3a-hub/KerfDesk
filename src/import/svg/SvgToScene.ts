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

type SvgColorMode = 'cut' | 'engrave' | 'score';
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

  let currentLayers = [...scene.layers];
  const objects: SceneObject[] = [];
  for (const el of parsed.elements) {
    const strokeColor = getSvgElementColor(el, 'stroke');
    const fillColor = getSvgElementColor(el, 'fill');
    const effectiveColor = strokeColor && strokeColor !== 'none' ? strokeColor : fillColor;
    const mode = colorToLayerMode(effectiveColor);
    const { layers: updatedLayers, layerId } = getOrCreateLayer(currentLayers, mode);
    currentLayers = updatedLayers;
    const obj = convertElement(el, layerId);
    if (obj) objects.push(obj);
  }

  // Group all imported objects together
  if (objects.length > 1) {
    const groupId = generateId();
    for (const obj of objects) {
      obj.parentId = groupId;
    }
  }

  return { ...scene, layers: currentLayers, objects };
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
  const parsed = parseSvg(svgString, {
    unitMode: options?.svgUnitMode,
  });

  let currentLayers = [...scene.layers];
  let objects: SceneObject[] = [];
  for (const el of parsed.elements) {
    const strokeColor = getSvgElementColor(el, 'stroke');
    const fillColor = getSvgElementColor(el, 'fill');
    const effectiveColor = strokeColor && strokeColor !== 'none' ? strokeColor : fillColor;

    let layerIdForObj: string;
    if (effectiveColor == null || effectiveColor === '' || effectiveColor === 'none') {
      layerIdForObj = layerId;
    } else {
      const mode = colorToLayerMode(effectiveColor);
      const { layers: updatedLayers, layerId: mappedId } = getOrCreateLayer(currentLayers, mode);
      currentLayers = updatedLayers;
      layerIdForObj = mappedId;
    }

    const obj = convertElement(el, layerIdForObj);
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

  // Group all imported objects together
  if (objects.length > 1) {
    const groupId = generateId();
    for (const obj of objects) {
      obj.parentId = groupId;
    }
  }

  return {
    ...scene,
    layers: currentLayers,
    objects: [...scene.objects, ...objects],
    metadata: {
      ...scene.metadata,
      modified: new Date().toISOString(),
    },
  };
}

// ─── SVG COLOR → LAYER MODE ──────────────────────────────────────

/**
 * Extract stroke/fill from flattened SvgElement (attribute or style).
 * Group inheritance is not available after flattening; colors should be on each shape or in style.
 */
function getSvgElementColor(el: SvgElement, attr: 'stroke' | 'fill'): string | null {
  const direct = el.attrs[attr];
  if (direct && direct !== 'inherit') return direct;

  const style = el.attrs['style'];
  if (style) {
    const match = style.match(new RegExp(`${attr}\\s*:\\s*([^;]+)`, 'i'));
    if (match) return match[1].trim();
  }

  return null;
}

/**
 * Map SVG stroke/fill color to a laser layer mode.
 * Follows the universal laser convention:
 *   Red → cut
 *   Blue → engrave
 *   Green → score
 *   Black → engrave (default for filled shapes)
 *   Everything else → cut
 */
function colorToLayerMode(color: string | null | undefined): SvgColorMode {
  if (!color || color === 'none') return 'cut';

  const c = color.toLowerCase().trim();

  // Named colors
  if (c === 'red' || c === 'crimson' || c === 'darkred') return 'cut';
  if (c === 'blue' || c === 'navy' || c === 'darkblue' || c === 'royalblue') return 'engrave';
  if (c === 'green' || c === 'lime' || c === 'darkgreen' || c === 'forestgreen') return 'score';
  if (c === 'black' || c === '#000' || c === '#000000') return 'engrave';

  // Hex colors — extract RGB
  let r = 0;
  let g = 0;
  let b = 0;

  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else if (c.startsWith('rgb')) {
    const match = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
      r = parseInt(match[1], 10);
      g = parseInt(match[2], 10);
      b = parseInt(match[3], 10);
    }
  }

  // Classify by dominant channel
  if (r > 150 && g < 100 && b < 100) return 'cut';       // Red-ish
  if (b > 150 && r < 100 && g < 100) return 'engrave';   // Blue-ish
  if (g > 150 && r < 100 && b < 100) return 'score';    // Green-ish

  // Default
  return 'cut';
}

function getOrCreateLayer(
  layers: Layer[],
  mode: SvgColorMode
): { layers: Layer[]; layerId: string } {
  const existing = layers.find(l => l.settings.mode === mode);
  if (existing) {
    return { layers, layerId: existing.id };
  }

  const newLayer = createLayer(
    layers.length,
    mode,
    mode === 'cut' ? 'Cut' : mode === 'engrave' ? 'Engrave' : 'Score'
  );
  return {
    layers: [...layers, newLayer],
    layerId: newLayer.id,
  };
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
    powerScale: 1,
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
