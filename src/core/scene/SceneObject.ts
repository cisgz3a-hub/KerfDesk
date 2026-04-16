/**
 * === FILE: /src/core/scene/SceneObject.ts ===
 * 
 * Purpose:    Defines every object type that can exist on the canvas.
 *             This is the fundamental data unit of the design engine.
 *             Objects are stored in a flat list, not a deep tree.
 * Dependencies: /src/core/types.ts
 * Last updated: Phase 1, Step 1 — Foundation
 */

import { type Point, type Matrix3x2, type AABB, IDENTITY_MATRIX, generateId } from '../types';

// ─── OBJECT TYPES ────────────────────────────────────────────────

export type ObjectType = 'path' | 'rect' | 'ellipse' | 'line' | 'polygon' | 'text' | 'image' | 'group';

// ─── PATH SEGMENT TYPES ──────────────────────────────────────────

export type PathSegment =
  | { type: 'move'; to: Point }
  | { type: 'line'; to: Point }
  | { type: 'cubic'; cp1: Point; cp2: Point; to: Point }
  | { type: 'quadratic'; cp: Point; to: Point }
  | { type: 'close' };

export interface SubPath {
  segments: PathSegment[];
  closed: boolean;
}

// ─── GEOMETRY VARIANTS ───────────────────────────────────────────

export interface RectGeometry {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;  // 0 = sharp corners
}

export interface EllipseGeometry {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface LineGeometry {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolygonGeometry {
  type: 'polygon';
  points: Point[];
  closed: boolean;
}

export interface PathGeometry {
  type: 'path';
  subPaths: SubPath[];
  /** Original text data preserved when converting text → path. Enables re-adjusting spacing after conversion. */
  sourceText?: TextGeometry;
}

export interface TextGeometry {
  type: 'text';
  text: string;
  fontSize: number;      // mm
  fontFamily: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  /** Percentage of font size; 0 = default tracking */
  letterSpacing?: number;
  /** Percentage of font height between baselines; default 120 */
  lineSpacing?: number;
  /** Percentage; 100 = default word gaps */
  wordSpacing?: number;
  /** Ephemeral: filled before compileJob for engrave/cut; not required for scene persistence */
  outlineSubPaths?: SubPath[];
}

export interface ImageGeometry {
  type: 'image';
  src: string;           // File path or data URI
  originalWidth: number; // px
  originalHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  grayscaleData?: Uint8Array;
  grayscaleWidth?: number;
  grayscaleHeight?: number;
  brightness?: number;
  contrast?: number;
  gamma?: number;
  invert?: boolean;
  adjustedData?: Uint8Array;
  /** Set when applying dithering from the properties panel */
  ditherMode?: import('../../import/Dithering').DitherMode;
}

export type Geometry =
  | RectGeometry
  | EllipseGeometry
  | LineGeometry
  | PolygonGeometry
  | PathGeometry
  | TextGeometry
  | ImageGeometry;

// ─── SCENE OBJECT ────────────────────────────────────────────────

export interface SceneObject {
  readonly id: string;
  type: ObjectType;
  name: string;
  layerId: string;
  parentId: string | null;   // For groups

  transform: Matrix3x2;
  geometry: Geometry;

  visible: boolean;
  locked: boolean;

  /** 0.0–1.0 multiplier on layer max power when cutting (default 1). */
  powerScale: number;

  /** Index into flattened path points where cutting begins (closed shapes). Default 0. */
  cutStartIndex?: number;

  // Cached values — null means needs recomputation
  _bounds: AABB | null;
  _worldTransform: Matrix3x2 | null;
}

// ─── FACTORY FUNCTIONS ───────────────────────────────────────────

export function createRect(
  layerId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  name?: string
): SceneObject {
  return {
    id: generateId(),
    type: 'rect',
    name: name || 'Rectangle',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: x, ty: y },
    geometry: { type: 'rect', x: 0, y: 0, width, height, cornerRadius: 0 },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

export function createEllipse(
  layerId: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  name?: string
): SceneObject {
  return {
    id: generateId(),
    type: 'ellipse',
    name: name || 'Ellipse',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX, tx: cx, ty: cy },
    geometry: { type: 'ellipse', cx: 0, cy: 0, rx, ry },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

export function createLine(
  layerId: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  name?: string
): SceneObject {
  return {
    id: generateId(),
    type: 'line',
    name: name || 'Line',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: { type: 'line', x1, y1, x2, y2 },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

export function createPolygon(
  layerId: string,
  points: Point[],
  closed: boolean = true,
  name?: string
): SceneObject {
  return {
    id: generateId(),
    type: 'polygon',
    name: name || 'Polygon',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: { type: 'polygon', points: [...points], closed },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}

export function createPath(
  layerId: string,
  subPaths: SubPath[],
  name?: string
): SceneObject {
  return {
    id: generateId(),
    type: 'path',
    name: name || 'Path',
    layerId,
    parentId: null,
    transform: { ...IDENTITY_MATRIX },
    geometry: { type: 'path', subPaths },
    visible: true,
    locked: false,
    powerScale: 1,
    _bounds: null,
    _worldTransform: null,
  };
}
