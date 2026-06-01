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
// luma buffer must be supplied externally... TODO: this path can't
// stay pure if it needs to decode the dataUrl. See F.2.d note below.
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
  let binary = '';
  try {
    binary = atob(base64);
  } catch {
    return whiteLuma(expectedLength);
  }
  const out = whiteLuma(expectedLength);
  const n = Math.min(binary.length, expectedLength);
  for (let i = 0; i < n; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
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
  const out: CutSegment[] = [];
  for (const obj of objects) {
    appendSegmentsFromObject(obj, layer, device, out);
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

// Shared materializer for any SceneObject whose paths are already
// available as ColoredPath polylines (ImportedSvg, TextObject,
// TracedImage). The switch above stays one-arm-per-kind for
// exhaustiveness, but each arm just delegates here — no duplicated
// coordinate-transform math.
//
// F.1 — when the layer's mode is 'fill', replace the per-color polylines
// with the output of fillHatching() BEFORE applying the object's
// transform. Doing the scanline math in object-local coordinates lets
// fillHatching work in a clean frame; the transform then moves the
// hatch lines to scene coordinates exactly the same way it would move
// the outline polylines.
function appendPathSegments(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
  out: CutSegment[],
): void {
  for (const path of paths) {
    if (path.color !== layer.color) continue;
    const polylines =
      layer.mode === 'fill' ? memoizedFillHatching(path.polylines, layer) : path.polylines;
    for (const polyline of polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      out.push({ polyline: points, closed: polyline.closed });
    }
  }
}
