import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type AABB,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
  type Transform,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';

// Stacked copies of one artwork (ADR-359). Duplicate-in-place followed by a
// nudge, a second import of the same file, or a re-trace that kept the old
// trace leaves several copies of the same art on output operations. Every copy
// compiles and burns, so on the bed they burn as a union: a white line or dot
// survives only where it is white in EVERY copy, and copies offset by a
// fraction of a millimetre fill in all the fine white detail the canvas shows.
// Warning only — an intentional double burn is legitimate (rule 7).

// Two copies count as stacked when they share at least half the smaller one's
// footprint; side-by-side copies of the same file are ordinary layouts.
const STACKED_OVERLAP_SHARE = 0.5;

type BurnedArtwork = {
  readonly source: string;
  // The footprint with the shared rotation undone, so two copies turned the
  // same way compare as the axis-aligned rectangles they really are.
  readonly box: AABB;
  readonly transform: Transform;
};

export function stackedCopyWarnings(project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  const byContent = new Map<string, BurnedArtwork[]>();
  for (const obj of project.scene.objects) {
    const identity = burnedArtworkIdentity(obj, operations);
    if (identity === null) continue;
    const copies = byContent.get(identity.key) ?? [];
    copies.push({
      source: identity.source,
      box: unrotatedFootprint(obj),
      transform: obj.transform,
    });
    byContent.set(identity.key, copies);
  }
  const warnings: string[] = [];
  for (const copies of byContent.values()) {
    const stacked = stackedCount(copies);
    const source = copies[0]?.source;
    if (stacked < 2 || source === undefined) continue;
    warnings.push(
      `${stacked} copies of "${source}" overlap on output operations. Every copy burns, so copies even slightly offset from one another fill in each other's fine white lines and dots. Delete the extra copies unless the stack is intentional.`,
    );
  }
  return warnings;
}

// Copies are the same CONTENT, not merely the same label: several different
// conversions can all be called "rect shape (bitmap)". Returns null when the
// object does not burn — the same test compile applies: a raster burns on an
// effective Image operation, a trace on any other mode.
function burnedArtworkIdentity(
  obj: SceneObject,
  operations: ReadonlyArray<Layer>,
): { readonly key: string; readonly source: string } | null {
  if (obj.kind === 'raster-image') {
    if (obj.role === 'trace-source' || !burnsAs(obj, operations, true)) return null;
    return { key: rasterContentKey(obj), source: obj.source };
  }
  if (obj.kind === 'traced-image') {
    if (!burnsAs(obj, operations, false)) return null;
    return { key: traceContentKey(obj), source: obj.source };
  }
  return null;
}

function rasterContentKey(obj: RasterImage): string {
  const content =
    obj.imageAsset?.lumaAssetId ?? fingerprint(obj.lumaBase64 ?? obj.dataUrl ?? obj.source);
  return `raster:${obj.pixelWidth}x${obj.pixelHeight}:${obj.imageMaskId ?? ''}:${content}`;
}

// Length plus an FNV-1a hash of a few dozen fixed windows: telling copies from
// different artwork without hashing tens of megabytes of base64 per Review. A
// collision only ever costs a spurious advisory.
const FINGERPRINT_WINDOWS = 48;
const FINGERPRINT_WINDOW_CHARS = 32;

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  const stride = Math.max(1, Math.floor(text.length / FINGERPRINT_WINDOWS));
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(text.length, start + FINGERPRINT_WINDOW_CHARS);
    for (let i = start; i < end; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function traceContentKey(obj: TracedImage): string {
  const polylines = obj.paths.reduce((n, path) => n + path.polylines.length, 0);
  const grid = `${obj.tracePixelWidth ?? 0}x${obj.tracePixelHeight ?? 0}`;
  return `trace:${obj.traceSourceId ?? obj.source}:${grid}:${obj.paths.length}:${polylines}`;
}

// Compile's own test: a raster burns on an effective Image operation; a trace
// burns only where both the operation and its effective settings are vector.
function burnsAs(obj: SceneObject, operations: ReadonlyArray<Layer>, image: boolean): boolean {
  return operations.some((operation) => {
    if (!sceneObjectUsesOperation(obj, operation)) return false;
    const effectiveIsImage = effectiveOperationForObject(operation, obj).mode === 'image';
    return image ? effectiveIsImage : operation.mode !== 'image' && !effectiveIsImage;
  });
}

// Sort-and-sweep on x: only copies whose footprints already overlap in x are
// compared, so a large array of side-by-side copies stays near linear.
function stackedCount(copies: ReadonlyArray<BurnedArtwork>): number {
  const sorted = [...copies].sort((a, b) => a.box.minX - b.box.minX);
  const stacked = new Set<BurnedArtwork>();
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b === undefined || b.box.minX > a.box.maxX) break;
      if (!sameOrientation(a.transform, b.transform) || !overlapsMostly(a.box, b.box)) continue;
      stacked.add(a);
      stacked.add(b);
    }
  }
  return stacked.size;
}

// The object's rectangle after scale and mirroring, placed at its translation
// turned back by its own rotation. Two copies with the same rotation then
// overlap exactly as much as these axis-aligned rectangles do.
function unrotatedFootprint(obj: SceneObject): AABB {
  const t = obj.transform;
  const rad = (-t.rotationDeg * Math.PI) / 180;
  const ox = t.x * Math.cos(rad) - t.y * Math.sin(rad);
  const oy = t.x * Math.sin(rad) + t.y * Math.cos(rad);
  const sx = (t.mirrorX ? -1 : 1) * t.scaleX;
  const sy = (t.mirrorY ? -1 : 1) * t.scaleY;
  const xs = [obj.bounds.minX * sx, obj.bounds.maxX * sx];
  const ys = [obj.bounds.minY * sy, obj.bounds.maxY * sy];
  return {
    minX: ox + Math.min(...xs),
    maxX: ox + Math.max(...xs),
    minY: oy + Math.min(...ys),
    maxY: oy + Math.max(...ys),
  };
}

// A nudged duplicate keeps its rotation, scale and mirroring; copies turned or
// resized differently are deliberate variations, not a stack.
function sameOrientation(a: Transform, b: Transform): boolean {
  return (
    a.rotationDeg === b.rotationDeg &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.mirrorX === b.mirrorX &&
    a.mirrorY === b.mirrorY
  );
}

function overlapsMostly(a: AABB, b: AABB): boolean {
  const overlap =
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
    Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 && overlap >= STACKED_OVERLAP_SHARE * smaller;
}

function area(box: AABB): number {
  return Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
}
