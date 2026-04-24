/**
 * Fast deterministic fingerprints for ValidatedJobTicket (mismatch detection only;
 * not a security primitive).
 */

import { type Scene } from '../scene/Scene';
import { type Geometry, type SceneObject, type TextGeometry } from '../scene/SceneObject';

/** 32-bit FNV-1a. Output is 8 lowercase hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Hash JSON-serializable values with sorted object keys (order-independent). */
export function hashObject(obj: unknown): string {
  const canonical = canonicalJson(obj);
  const g = globalThis as { __LF_HASH_DEBUG?: boolean; __LF_LAST_HASH_INPUT?: string };
  if (g.__LF_HASH_DEBUG) {
    g.__LF_LAST_HASH_INPUT = canonical;
  }
  return hashString(canonical);
}

/** Strip text outline cache — derived at compile from font/text; must not affect ticket identity. */
function stripTextGeometryForTicket(g: TextGeometry): TextGeometry {
  const { outlineSubPaths: _o, ...rest } = g;
  return rest;
}

/** Geometry snapshot for hashing — omits compile-time-only / view-cache fields. */
function stripGeometryForTicket(g: Geometry): Geometry {
  switch (g.type) {
    case 'text':
      return stripTextGeometryForTicket(g);
    case 'path': {
      if (!g.sourceText) return g;
      return { ...g, sourceText: stripTextGeometryForTicket(g.sourceText) };
    }
    default:
      return g;
  }
}

/** SceneObject fields that affect the job; omits `_bounds` / `_worldTransform` (viewport caches). */
function stripObjectForTicketHash(o: SceneObject): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: o.id,
    type: o.type,
    name: o.name,
    layerId: o.layerId,
    parentId: o.parentId,
    transform: o.transform,
    geometry: stripGeometryForTicket(o.geometry),
    visible: o.visible,
    locked: o.locked,
    powerScale: o.powerScale,
  };
  if (o.cutStartIndex !== undefined) {
    base.cutStartIndex = o.cutStartIndex;
  }
  return base;
}

/**
 * Stable scene fingerprint for `ValidatedJobTicket.sceneHash` and `validateTicket`.
 * Uses the live document model only — not the text-expanded clone, and not view caches
 * (`_bounds`, `_worldTransform`) that differ between compile and Start.
 */
export function hashSceneForTicket(scene: Scene): string {
  return hashObject({
    id: scene.id,
    version: scene.version,
    canvas: scene.canvas,
    layers: scene.layers,
    objects: scene.objects.map(stripObjectForTicketHash),
    material: scene.material,
    startPosition: scene.startPosition,
    machine: scene.machine,
    compileOptions: scene.compileOptions,
    activeLayerId: scene.activeLayerId,
    metadata: scene.metadata,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = o[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

let ticketSeq = 0;

function isDeterministicIds(): boolean {
  if (typeof process !== 'undefined' && process.env?.LASERFORGE_DETERMINISTIC_IDS === '1') {
    return true;
  }
  if (typeof globalThis !== 'undefined') {
    return (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ === true;
  }
  return false;
}

/** Unique per compile. Not a content hash. */
export function generateTicketId(): string {
  if (isDeterministicIds()) {
    ticketSeq += 1;
    return `tkt_det_${String(ticketSeq).padStart(6, '0')}`;
  }
  return `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
