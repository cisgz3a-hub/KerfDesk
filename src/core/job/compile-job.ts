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
import { dither } from '../raster';
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
import { fillHatching } from './fill-hatching';
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
        groups.push(compileRasterGroup(obj, layer, device));
      }
      continue;
    }
    const segments = collectSegmentsForLayer(scene.objects, layer, device);
    if (segments.length === 0) continue;
    groups.push({
      kind: 'cut',
      layerId: layer.id,
      color: layer.color,
      power: clamp(layer.power, 0, 100),
      speed: Math.min(layer.speed, device.maxFeed),
      passes: Math.max(1, Math.floor(layer.passes)),
      segments,
    });
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
  // F.2.d v1 stub: we synthesise an empty (all-zero) luma buffer at
  // pixel dimensions. The UI layer will, in a follow-up, pre-compute
  // the luma buffer from the decoded image and attach it to the
  // RasterImage (or to a parallel preview-cache). For now this
  // shape lets the dispatcher + emit path be testable end-to-end
  // with synthetic input; once luma extraction lands the only
  // change is replacing `lumaPlaceholder` here with a real
  // pre-extracted buffer carried on the object.
  const lumaPlaceholder = new Uint8Array(obj.pixelWidth * obj.pixelHeight);
  const sMax = Math.round((clamp(layer.power, 0, 100) / 100) * device.maxPowerS);
  const sValues = dither(
    { luma: lumaPlaceholder, width: obj.pixelWidth, height: obj.pixelHeight },
    { algorithm: obj.dither, sMax },
  );
  return {
    kind: 'raster',
    layerId: layer.id,
    color: layer.color,
    power: clamp(layer.power, 0, 100),
    speed: Math.min(layer.speed, device.maxFeed),
    sValues,
    pixelWidth: obj.pixelWidth,
    pixelHeight: obj.pixelHeight,
    bounds: rasterBoundsInMachineCoords(obj, device),
    overscanMm: DEFAULT_OVERSCAN_MM,
  };
}

// Apply object transform + device origin transform to the image's
// natural bounds and return the AABB in machine coords. Same
// convention as CutGroup polylines after toMachineCoords.
function rasterBoundsInMachineCoords(
  obj: RasterImage,
  device: DeviceProfile,
): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const tl = toMachineCoords(
    applyTransform({ x: obj.bounds.minX, y: obj.bounds.minY }, obj.transform),
    device,
  );
  const br = toMachineCoords(
    applyTransform({ x: obj.bounds.maxX, y: obj.bounds.maxY }, obj.transform),
    device,
  );
  return {
    minX: Math.min(tl.x, br.x),
    maxX: Math.max(tl.x, br.x),
    minY: Math.min(tl.y, br.y),
    maxY: Math.max(tl.y, br.y),
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
      layer.mode === 'fill'
        ? fillHatching({
            polylines: path.polylines,
            hatchAngleDeg: layer.hatchAngleDeg,
            hatchSpacingMm: layer.hatchSpacingMm,
          })
        : path.polylines;
    for (const polyline of polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      out.push({ polyline: points, closed: polyline.closed });
    }
  }
}
