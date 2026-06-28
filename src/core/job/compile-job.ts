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

/* eslint-disable max-lines -- Merge keeps raster/vector/lane compilation together; split next. */
import { type DeviceProfile, toMachineCoords } from '../devices';
import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import { applyAutomaticTabsToPolylines } from '../geometry/tabs-bridges';
import {
  applyLumaAdjustments,
  applyImageMaskToLuma,
  dither,
  maybeInvertLuma,
  pixelExtentForMm,
  resampleLumaNearest,
  whiteLuma,
} from '../raster';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  objectPowerScalePercent,
} from './object-power-scale';
import {
  applyTransform,
  assertNever,
  type ColoredPath,
  type Layer,
  layerOperationSettingsEqual,
  layerFromSubLayer,
  type Polyline,
  type RasterImage,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import { memoizedFillHatchingWithMetadata } from './fill-hatching-cache';
import { fillRuleForLayer, layerFillCacheKey } from './fill-rule';
import { groupFillContoursIntoIslands } from './island-fill';
import { offsetFillContours } from './offset-fill';
import { rasterBoundsInMachineCoords } from './raster-bounds';
import type { CutGroup, CutSegment, FillSegment, Group, Job, RasterGroup } from './job';

// Default overscan kept here (not on Layer) so it can ride device
// profiles in the future without a .lf2 schema bump. 5 mm matches
// the ADR-020 baseline for diode lasers.
export const DEFAULT_OVERSCAN_MM = 5;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MAX_LAYER_FILL_CACHE_ENTRIES = 8;
const WHITE_LUMA_BYTE = 255;

// Allowed module-level cache (narrow exception to "no module-level mutable") —
// see ADR-050. Identity-keyed via WeakMap (GC-bounded), output-invariant, inner
// map capped at MAX_LAYER_FILL_CACHE_ENTRIES, pinned by compile-job-fill-cache.test.ts.
const layerFillCache = new WeakMap<
  ReadonlyArray<SceneObject>,
  Map<string, ReadonlyArray<FillSegmentAsPolyline>>
>();

export function compileJob(scene: Scene, device: DeviceProfile): Job {
  const groups: Group[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    for (const operationLayer of outputOperationLayers(layer)) {
      if (operationLayer.mode === 'image') {
        // F.2.d: image-mode layer dispatches to raster compile. The
        // layer's color binds to RasterImage objects via obj.color;
        // every matching raster becomes its own RasterGroup. Open
        // question for future: multi-image-on-one-layer behaviour
        // (today we emit one group per image — operators can split
        // by layer if they want different power/dither per image).
        for (const obj of scene.objects) {
          if (obj.kind !== 'raster-image' || obj.color !== operationLayer.color) continue;
          if (obj.role === 'trace-source') continue;
          const effectiveLayer = layerWithObjectOverride(operationLayer, obj);
          if (effectiveLayer.mode !== 'image') continue;
          groups.push(compileRasterGroup(obj, effectiveLayer, device, scene.objects));
        }
        continue;
      }
      groups.push(...compileVectorGroupsForLayer(scene.objects, operationLayer, device));
      groups.push(...compileRasterGroupsForLayer(scene.objects, operationLayer, device));
    }
  }
  return { groups };
}

function outputOperationLayers(layer: Layer): ReadonlyArray<Layer> {
  return [layer, ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer))].filter(
    (operationLayer) => operationLayer.output,
  );
}

function compileRasterGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): RasterGroup[] {
  const groups: RasterGroup[] = [];
  for (const obj of objects) {
    if (obj.kind !== 'raster-image' || obj.color !== layer.color) continue;
    if (obj.role === 'trace-source') continue;
    const effectiveLayer = layerWithObjectOverride(layer, obj);
    if (effectiveLayer.mode !== 'image') continue;
    groups.push(compileRasterGroup(obj, effectiveLayer, device, objects));
  }
  return groups;
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
function compileRasterGroup(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  objects: ReadonlyArray<SceneObject>,
): RasterGroup {
  // Missing/corrupt luma fails safe to white (S0), not black/full-burn.
  const sourceLuma =
    obj.lumaBase64 !== undefined
      ? decodeBase64Luma(obj.lumaBase64, obj.pixelWidth * obj.pixelHeight)
      : whiteLuma(obj.pixelWidth * obj.pixelHeight);
  const adjustedLuma = applyLumaAdjustments(sourceLuma, obj);
  const preparedLuma = maybeInvertLuma(adjustedLuma, layer.negativeImage);
  const powerPercent = effectiveObjectPowerPercent(layer, obj);
  const minPowerPercent = effectiveObjectMinPowerPercent(layer, obj);
  const sMax = Math.round((powerPercent / 100) * device.maxPowerS);
  const sMin = Math.round((minPowerPercent / 100) * device.maxPowerS);
  const bounds = rasterBoundsInMachineCoords(obj, device);
  const pixelWidth = layer.passThrough
    ? obj.pixelWidth
    : pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm);
  const pixelHeight = layer.passThrough
    ? obj.pixelHeight
    : pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm);
  const lineIntervalMm = (bounds.maxY - bounds.minY) / pixelHeight;
  const luma = layer.passThrough
    ? preparedLuma
    : resampleLumaNearest(
        { luma: preparedLuma, width: obj.pixelWidth, height: obj.pixelHeight },
        pixelWidth,
        pixelHeight,
      );
  const maskedLuma = applyImageMaskToLuma({
    image: obj,
    maskObject: imageMaskObjectFor(obj, objects),
    luma,
    width: pixelWidth,
    height: pixelHeight,
  });
  // Layer settings win over per-image settings so the operator can
  // re-tune one layer without editing every image on it.
  const orientedLuma = orientRasterLumaForMachine(maskedLuma, pixelWidth, pixelHeight, obj, device);
  const sValues = dither(
    { luma: orientedLuma, width: pixelWidth, height: pixelHeight },
    { algorithm: layer.ditherAlgorithm, sMax, sMin },
  );
  return {
    kind: 'raster',
    layerId: layer.id,
    color: layer.color,
    power: powerPercent,
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
    sValues,
    pixelWidth,
    pixelHeight,
    bounds,
    overscanMm: DEFAULT_OVERSCAN_MM,
    dotWidthCorrectionMm: clamp(layer.dotWidthCorrectionMm, 0, lineIntervalMm),
    bidirectional: layer.imageBidirectional,
  };
}

function imageMaskObjectFor(
  obj: RasterImage,
  objects: ReadonlyArray<SceneObject>,
): SceneObject | null {
  if (obj.imageMaskId === undefined) return null;
  return objects.find((candidate) => candidate.id === obj.imageMaskId) ?? null;
}

function orientRasterLumaForMachine(
  luma: Uint8Array,
  width: number,
  height: number,
  obj: RasterImage,
  device: DeviceProfile,
): Uint8Array {
  // Negative scale (a handle dragged across the anchor) is a mirror: the
  // canvas and dither preview render it flipped, so the burn must flip too
  // (M3). XOR with the explicit mirror flags — a double flip is upright.
  const objFlipX = obj.transform.mirrorX !== obj.transform.scaleX < 0;
  const objFlipY = obj.transform.mirrorY !== obj.transform.scaleY < 0;
  const flipX = originFlipsRasterX(device) !== objFlipX;
  const flipY = originFlipsRasterY(device) !== objFlipY;
  if (!flipX && !flipY) return luma;
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < height; y += 1) {
    const srcY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const srcX = flipX ? width - 1 - x : x;
      out[y * width + x] = luma[srcY * width + srcX] ?? WHITE_LUMA_BYTE;
    }
  }
  return out;
}

function originFlipsRasterX(device: DeviceProfile): boolean {
  return device.origin === 'front-right' || device.origin === 'rear-right';
}

function originFlipsRasterY(device: DeviceProfile): boolean {
  return (
    device.origin === 'front-left' || device.origin === 'front-right' || device.origin === 'center'
  );
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function compileVectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Group[] {
  const matchingObjects = objects.filter((obj) => vectorObjectMatchesLayer(obj, layer));
  if (matchingObjects.every((obj) => obj.operationOverride === undefined)) {
    return vectorGroupsForObjects(objects, matchingObjects, layer, device);
  }

  const groups: Group[] = [];
  for (const bucket of vectorObjectBucketsForLayer(objects, layer)) {
    groups.push(...vectorGroupsForObjects(bucket.objects, bucket.objects, bucket.layer, device));
  }
  return groups;
}

function vectorGroupsForObjects(
  sourceObjects: ReadonlyArray<SceneObject>,
  matchingObjects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Group[] {
  const sharedScale = sharedObjectPowerScalePercent(matchingObjects);
  if (sharedScale !== undefined) {
    return vectorGroupsForLayer(sourceObjects, layer, device, { powerScale: sharedScale });
  }
  const groups: Group[] = [];
  for (const obj of matchingObjects) {
    groups.push(...vectorGroupsForLayer([obj], layer, device, obj));
  }
  return groups;
}

function vectorObjectBucketsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): ReadonlyArray<{ readonly layer: Layer; readonly objects: ReadonlyArray<SceneObject> }> {
  const buckets: Array<{ layer: Layer; objects: SceneObject[] }> = [];
  for (const obj of objects) {
    if (!vectorObjectMatchesLayer(obj, layer)) continue;
    const effectiveLayer = layerWithObjectOverride(layer, obj);
    if (effectiveLayer.mode === 'image') continue;
    const bucket = buckets.find((candidate) =>
      layerOperationSettingsEqual(candidate.layer, effectiveLayer),
    );
    if (bucket === undefined) {
      buckets.push({ layer: effectiveLayer, objects: [obj] });
    } else {
      bucket.objects.push(obj);
    }
  }
  return buckets;
}

function layerWithObjectOverride(layer: Layer, obj: SceneObject): Layer {
  if (obj.operationOverride === undefined) return layer;
  return { ...layer, ...obj.operationOverride };
}

function vectorGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Group[] {
  if (layer.mode === 'fill') {
    if (layer.fillStyle === 'island') {
      return islandFillGroupsForLayer(objects, layer, device, powerSource);
    }
    const segments = collectFillSegmentsForLayer(objects, layer, device);
    if (segments.length === 0) return [];
    const common = commonGroupFields(layer, device, powerSource);
    return [
      {
        ...common,
        kind: 'fill' as const,
        fillStyle: layer.fillStyle,
        overscanMm: Math.max(0, layer.fillOverscanMm),
        segments,
      },
    ];
  }
  const segments = collectLineSegmentsForLayer(objects, layer, device);
  if (segments.length === 0) return [];
  const common = commonGroupFields(layer, device, powerSource);
  return [{ ...common, kind: 'cut' as const, segments }];
}

function islandFillGroupsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Group[] {
  const common = commonGroupFields(layer, device, powerSource);
  const fillRule = fillRuleForLayer(objects, layer);
  const contours = collectFillContoursForLayer(objects, layer, device);
  return groupFillContoursIntoIslands(contours).flatMap((island): Group[] => {
    const segments = memoizedFillHatchingWithMetadata(island, layer, fillRule).map((polyline) => ({
      polyline: polyline.points,
      closed: polyline.closed,
      reverse: polyline.reverse,
    }));
    if (segments.length === 0) return [];
    return [
      {
        ...common,
        kind: 'fill',
        fillStyle: 'island',
        overscanMm: Math.max(0, layer.fillOverscanMm),
        segments,
      },
    ];
  });
}

function commonGroupFields(
  layer: Layer,
  device: DeviceProfile,
  powerSource: SceneObject | { readonly powerScale: number },
): Omit<CutGroup, 'kind' | 'segments'> {
  return {
    layerId: layer.id,
    color: layer.color,
    power: effectiveObjectPowerPercent(layer, powerSource),
    speed: Math.min(layer.speed, device.maxFeed),
    passes: Math.max(1, Math.floor(layer.passes)),
    airAssist: layer.airAssist,
  };
}

function sharedObjectPowerScalePercent(objects: ReadonlyArray<SceneObject>): number | undefined {
  let sharedScale: number | undefined;
  for (const obj of objects) {
    const scale = objectPowerScalePercent(obj);
    if (sharedScale === undefined) {
      sharedScale = scale;
    } else if (sharedScale !== scale) {
      return undefined;
    }
  }
  return sharedScale;
}

function vectorObjectMatchesLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.paths.some((path) => path.color === layer.color);
    case 'raster-image':
      return false;
    default:
      assertNever(obj, 'SceneObject');
  }
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
  if (!layer.tabsEnabled) return out;
  return applyAutomaticTabsToPolylines(
    out.map((segment) => ({ points: segment.polyline, closed: segment.closed })),
    layer,
  ).map((polyline) => ({ polyline: polyline.points, closed: polyline.closed }));
}

function collectFillSegmentsForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): FillSegment[] {
  const polylines =
    layer.fillStyle === 'offset'
      ? offsetFillContours({
          polylines: collectFillContoursForLayer(objects, layer, device),
          spacingMm: layer.hatchSpacingMm,
        }).map((polyline) => ({ ...polyline, reverse: false }))
      : memoizedLayerFillHatching(objects, layer, device);
  return polylines.map((polyline) => ({
    polyline: polyline.points,
    closed: polyline.closed,
    reverse: polyline.reverse,
  }));
}

function memoizedLayerFillHatching(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<FillSegmentAsPolyline> {
  const fillRule = fillRuleForLayer(objects, layer);
  const cacheKey = layerFillCacheKey(layer, device, fillRule);
  let bySettings = layerFillCache.get(objects);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<FillSegmentAsPolyline>>();
    layerFillCache.set(objects, bySettings);
  }
  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const contours = collectFillContoursForLayer(objects, layer, device);
  const hatches = memoizedFillHatchingWithMetadata(contours, layer, fillRule);
  if (bySettings.size >= MAX_LAYER_FILL_CACHE_ENTRIES) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}

type FillSegmentAsPolyline = Polyline & { readonly reverse: boolean };

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
    case 'shape':
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
    case 'shape':
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
    const closedForKerf: Polyline[] = [];
    for (const polyline of path.polylines) {
      const points: Vec2[] = polyline.points.map((p) =>
        toMachineCoords(applyTransform(p, transform), device),
      );
      if (shouldApplyKerf(polyline, layer)) {
        closedForKerf.push({ points, closed: true });
      } else {
        out.push({ polyline: points, closed: polyline.closed });
      }
    }
    for (const offset of offsetClosedPolylinesForKerf(closedForKerf, layer.kerfOffsetMm)) {
      out.push({ polyline: offset.points, closed: true });
    }
  }
}

function shouldApplyKerf(polyline: Polyline, layer: Layer): boolean {
  return layer.mode === 'line' && layer.kerfOffsetMm !== 0 && polyline.closed;
}
