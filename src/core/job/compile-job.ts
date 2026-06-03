// compileJob — Scene + DeviceProfile → Job.
//
// Walks every output-enabled Layer, materializes its polylines from the
// SceneObjects that match its color, applies each object's transform and the
// device's origin transform, and bundles the result with the layer's
// power / speed / passes.
//
// Pure: depends only on its arguments. No clock, no random, no I/O.
// Determinism: iteration order matches scene.layers and scene.objects (both
// arrays, indexed loops) → repeatable across runs.

import { type DeviceProfile, toMachineCoords } from '../devices';
import { dither, pixelExtentForMm, resampleLumaNearest, whiteLuma } from '../raster';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  type Polyline,
  type RasterImage,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import { memoizedFillHatching } from './fill-hatching-cache';
import type { CutSegment, Group, Job, RasterGroup } from './job';

// Default overscan kept here (not on Layer) so it can ride device
// profiles in the future without a .lf2 schema bump. 5 mm matches
// the ADR-020 baseline for diode lasers.
const DEFAULT_OVERSCAN_MM = 5;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_LAYER_FILL_CACHE_ENTRIES = 8;

const layerFillCache = new WeakMap<
  ReadonlyArray<SceneObject>,
  Map<string, ReadonlyArray<Polyline>>
>();

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: Group[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    if (layer.mode === 'image') {
      // F.2.d: image-mode layer dispatches to raster compile. The
      // layer's color binds to RasterImage objects via obj.color;
      // every matching raster becomes its own RasterGroup. Open
      // question for future: multi-image-on-one-layer behaviour
      // (today we emit one group per image — operators can split
      // by layer if they want different power/dither per image).
      for (const obj of scene.objects) {
        if (obj.kind !== 'raster-image' || obj.color !== layer.color) continue;
        if (obj.role === 'trace-source') continue;
        groups.push(compileRasterGroup(obj, layer, device));
      }
      continue;
    }
    const segments = collectSegmentsForLayer(scene.objects, layer, device);
    if (segments.length === 0) continue;
    const common = {
      layerId: layer.id,
      color: layer.color,
      power: clamp(layer.power, 0, 100),
      speed: Math.min(layer.speed, device.maxFeed),
      passes: Math.max(1, Math.floor(layer.passes)),
      segments,
    };
    groups.push(
      layer.mode === 'fill'
        ? { ...common, kind: 'fill', overscanMm: Math.max(0, layer.fillOverscanMm) }
        : { ...common, kind: 'cut' },
    );
  }
  return { groups };
}

// Builds a RasterGroup from one RasterImage + its Layer settings.
// dither() turns the source pixels into a per-pixel S-value array
// already scaled by layer.power; emit-raster only has to lay the
// pixels onto the bed.
//
// Pure: depends on layer config and the image's data — the actual
// PNG decoding has already happened upstream when the RasterImage
// was created (UI layer; image-loader.ts). We work from `dataUrl`
// metadata only via pixelWidth/pixelHeight; the actual greyscale
// luma buffer is stored separately as base64 and decoded locally.
function compileRasterGroup(obj: RasterImage, layer: Layer, device: DeviceProfile): RasterGroup {
  // Missing/corrupt luma fails safe to white (S0), not black/full-burn.
  const sourceLuma =
    obj.lumaBase64 !== undefined
      ? decodeBase64Luma(obj.lumaBase64, obj.pixelWidth * obj.pixelHeight)
      : whiteLuma(obj.pixelWidth * obj.pixelHeight);
  const sMax = Math.round((clamp(layer.power, 0, 100) / 100) * device.maxPowerS);
  const bounds = rasterBoundsInMachineCoords(obj, device);
  const pixelWidth = pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const pixelHeight = pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  const luma = resampleLumaNearest(
    { luma: sourceLuma, width: obj.pixelWidth, height: obj.pixelHeight },
    pixelWidth,
    pixelHeight,
  );
  // Layer settings win over per-image settings so the operator can
  // re-tune one layer without editing every image on it.
  const sValues = dither(
    { luma, width: pixelWidth, height: pixelHeight },
    { algorithm: layer.ditherAlgorithm, sMax },
  );
  return {
    kind: 'raster',
    layerId: layer.id,
    color: layer.color,
    power: clamp(layer.power, 0, 100),
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    sValues,
    pixelWidth,
    pixelHeight,
    bounds,
    overscanMm: DEFAULT_OVERSCAN_MM,
  };
}

// Decode a base64-encoded luma buffer. Truncates / pads to the expected
// length so a corrupt or partial buffer does not blow up the dither.
// Missing/corrupt bytes are white so the laser stays off.
function decodeBase64Luma(base64: string, expectedLength: number): Uint8Array {
  const out = whiteLuma(expectedLength);
  let outIndex = 0;
  let buffer = 0;
  let bitCount = 0;
  for (const char of base64) {
    if (outIndex >= expectedLength || char === '=') break;
    if (isBase64Whitespace(char)) continue;
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) return whiteLuma(expectedLength);
    buffer = (buffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[outIndex] = (buffer >> bitCount) & 0xff;
      outIndex += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  return out;
}

function isBase64Whitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

// Apply object transform + device origin transform to the image's
// natural bounds and return the AABB in machine coords. Same
// convention as CutGroup polylines after toMachineCoords.
function rasterBoundsInMachineCoords(
  obj: RasterImage,
  device: DeviceProfile,
): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const corners = [
    { x: obj.bounds.minX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.minY },
    { x: obj.bounds.maxX, y: obj.bounds.maxY },
    { x: obj.bounds.minX, y: obj.bounds.maxY },
  ].map((p) => toMachineCoords(applyTransform(p, obj.transform), device));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function collectSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  if (layer.mode === 'fill') return collectFillSegmentsForLayer(objects, layer, device);
  return collectLineSegmentsForLayer(objects, layer, device);
}

function collectLineSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  const out: CutSegment[] = [];
  for (const obj of objects) {
    appendSegmentsFromObject(obj, layer, device, out);
  }
  return out;
}

function collectFillSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): CutSegment[] {
  return memoizedLayerFillHatching(objects, layer, device).map((polyline) => ({
    polyline: polyline.points,
    closed: polyline.closed,
  }));
}

function memoizedLayerFillHatching(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<Polyline> {
  const cacheKey = layerFillCacheKey(layer, device);
  let bySettings = layerFillCache.get(objects);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<Polyline>>();
    layerFillCache.set(objects, bySettings);
  }
  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const contours = collectFillContoursForLayer(objects, layer, device);
  const hatches = memoizedFillHatching(contours, layer);
  if (bySettings.size >= MAX_LAYER_FILL_CACHE_ENTRIES) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}

function layerFillCacheKey(layer: Layer, device: DeviceProfile): string {
  return [
    layer.color,
    layer.hatchAngleDeg,
    layer.hatchSpacingMm,
    device.origin,
    device.bedWidth,
    device.bedHeight,
  ].join(':');
}

function collectFillContoursForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Polyline[] {
  const out: Polyline[] = [];
  for (const obj of objects) {
    appendFillContoursFromObject(obj, layer, device, out);
  }
  return out;
}

function appendSegmentsFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  // Exhaustive over SceneObject.kind — enforced by
  // `@typescript-eslint/switch-exhaustiveness-check`. The default arm's
  // assertNever turns missing arms into compile errors when a new
  // variant lands (per ADR-014).
  switch (obj.kind) {
    case 'imported-svg':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'text':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'traced-image':
      appendPathSegments(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
      // F.2.c: SceneObject union now includes raster-image. The
      // dedicated raster emit path (compileRasterGroup → emitRaster)
      // lands in F.2.d; for this commit, raster images don't
      // contribute polyline segments and the compile path skips
      // them. Behaviour parity with the F.2.b standalone emit-raster
      // tests preserved.
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function appendFillContoursFromObject(
  obj: SceneObject,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  switch (obj.kind) {
    case 'imported-svg':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'text':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'traced-image':
      appendFillPathContours(obj.paths, obj.transform, layer, device, out);
      return;
    case 'raster-image':
      return;
    default:
      assertNever(obj, 'SceneObject');
  }
}

function appendFillPathContours(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
  out: Polyline[],
): void {
  for (const path of paths) {
    if (path.color !== layer.color) continue;
    for (const polyline of path.polylines) {
      out.push({
        points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
        closed: polyline.closed,
      });
    }
  }
}

// Shared materializer for any SceneObject whose paths are already
// available as ColoredPath polylines (ImportedSvg, TextObject,
// TracedImage). The switch above stays one-arm-per-kind for
// exhaustiveness, but each arm just delegates here — no duplicated
// coordinate-transform math.
//
// Line mode transforms source contours directly. Fill mode uses the
// layer-wide machine-space path above so hatch spacing is physical and
// same-layer contours interact before hatching.
function appendPathSegments(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  for (const path of paths) {
    if (path.color !== layer.color) continue;
    for (const polyline of path.polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      out.push({ polyline: points, closed: polyline.closed });
    }
  }
}
