import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import { getOutputLayers } from '../../scene/Scene';
import type { SceneObject } from '../../scene/SceneObject';
import { computeObjectBounds } from '../../../geometry/bounds';

function hasUsableObjectBounds(bounds: ReturnType<typeof computeObjectBounds>): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) &&
    bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
}

function isObjectOutsideMaterial(
  obj: SceneObject,
  material: { x: number; y: number; width: number; height: number },
): { outside: boolean; partial: boolean } {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return { outside: false, partial: false };

  const matMinX = material.x;
  const matMinY = material.y;
  const matMaxX = material.x + material.width;
  const matMaxY = material.y + material.height;

  const fullyOutside =
    bounds.maxX < matMinX ||
    bounds.minX > matMaxX ||
    bounds.maxY < matMinY ||
    bounds.minY > matMaxY;

  if (fullyOutside) return { outside: true, partial: false };

  const partiallyOutside =
    bounds.minX < matMinX ||
    bounds.maxX > matMaxX ||
    bounds.minY < matMinY ||
    bounds.maxY > matMaxY;

  return { outside: false, partial: partiallyOutside };
}

function isObjectOutsideBed(
  obj: SceneObject,
  bed: { width: number; height: number },
): boolean {
  const bounds = computeObjectBounds(obj);
  if (!hasUsableObjectBounds(bounds)) return false;
  return (
    bounds.minX < 0 ||
    bounds.minY < 0 ||
    bounds.maxX > bed.width ||
    bounds.maxY > bed.height
  );
}

export function runDesignOutputLayerChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { scene } = ctx;
  if (scene.objects.length === 0) return;

  const outputLayers = getOutputLayers(scene);
  const outputLayerIds = new Set(outputLayers.map(l => l.id));
  const outputObjects = scene.objects.filter(o => o.visible && outputLayerIds.has(o.layerId));

  if (outputObjects.length === 0) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.DESIGN_NO_OUTPUT,
      message:
        'No objects on output layers — nothing will be sent to the laser. Objects are hidden, on hidden layers, or on layers excluded from output.',
    });
  }

  if (scene.material && scene.material.enabled !== false) {
    const mat = scene.material;
    for (const obj of outputObjects) {
      const { outside, partial } = isObjectOutsideMaterial(obj, mat);
      if (outside) {
        out.push({
          severity: 'error',
          code: PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_FULL,
          message: `Object "${obj.name || obj.id}" is completely outside the material area (${mat.width}×${mat.height}mm at ${mat.x}, ${mat.y}).`,
          objectId: obj.id,
        });
      } else if (partial) {
        out.push({
          severity: 'warning',
          code: PREFLIGHT_CODES.DESIGN_OUTSIDE_MATERIAL_PARTIAL,
          message: `Object "${obj.name || obj.id}" extends past the material edge (${mat.width}×${mat.height}mm at ${mat.x}, ${mat.y}).`,
          objectId: obj.id,
        });
      }
    }
  }

  for (const obj of outputObjects) {
    const bed = { width: ctx.preflightBedWidthMm, height: ctx.preflightBedHeightMm };
    if (isObjectOutsideBed(obj, bed)) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.DESIGN_OUTSIDE_BED,
        message: `Object "${obj.name || obj.id}" is outside the laser bed travel area (${bed.width}×${bed.height}mm).`,
        objectId: obj.id,
      });
    }
  }

  for (const obj of outputObjects) {
    if (obj.geometry.type !== 'text') continue;
    const g = obj.geometry;
    const fontSize = g.fontSize || 10;
    if (fontSize < 4) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.TEXT_FONT_TOO_SMALL,
        message: `Text "${obj.name}" has a very small font (${fontSize.toFixed(1)}mm). Small or thin text may not convert to outlines correctly.`,
        objectId: obj.id,
      });
    }
    if (!g.text?.trim()) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.TEXT_EMPTY,
        message: `Text object "${obj.name}" is empty and will produce no output.`,
        objectId: obj.id,
      });
    }
  }

  for (const obj of outputObjects) {
    const layer = scene.layers.find(l => l.id === obj.layerId);
    if (!layer || layer.settings.mode !== 'engrave') continue;
    const rawIv = Number(layer.settings.fill.interval);
    const interval = Math.max(0.01, Number.isFinite(rawIv) && rawIv > 0 ? rawIv : 0.1);
    const bounds = computeObjectBounds(obj);
    if (!hasUsableObjectBounds(bounds)) continue;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const minDim = Math.min(w, h);
    if (minDim < 2 * interval) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.ENGRAVE_FILL_TOO_SMALL,
        message:
          `Object "${obj.name || obj.id}" may be too small for engrave fill (span ≈ ${minDim.toFixed(2)}mm, line spacing ${interval.toFixed(2)}mm).`,
        objectId: obj.id,
        layerId: layer.id,
      });
    }
  }

  for (const obj of outputObjects) {
    if (obj.geometry.type !== 'image') continue;
    const layer = scene.layers.find(l => l.id === obj.layerId);
    if (layer?.settings.mode === 'image') {
      const g = obj.geometry;
      const hasRasterPixels =
        (g.grayscaleData?.length ?? 0) > 0 &&
        (g.grayscaleWidth ?? 0) > 0 &&
        (g.grayscaleHeight ?? 0) > 0;
      if (!hasRasterPixels) {
        out.push({
          severity: 'error',
          code: PREFLIGHT_CODES.IMAGE_MISSING_RASTER,
          message: `Image "${obj.name || obj.id}" has no raster data loaded and cannot produce engraving output.`,
          objectId: obj.id,
        });
      }
    }
    const t = obj.transform;
    const EPS = 0.001;
    if (Math.abs(t.b) > EPS || Math.abs(t.c) > EPS) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.IMAGE_ROTATED_SKEWED,
        message: `Image "${obj.name || obj.id}" is rotated or skewed — raster compile does not support rotation.`,
        objectId: obj.id,
      });
    }
  }

  for (const layer of outputLayers) {
    if (layer.settings.mode === 'cut' && layer.settings.power.max > 95 && layer.settings.speed < 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.SETTINGS_CUT_OVERBURN,
        message: `Layer "${layer.name}" high power + slow speed (${layer.settings.power.max}% at ${layer.settings.speed}mm/min) may cause burning or fire.`,
        layerId: layer.id,
      });
    }
  }

  if (outputLayers.length > 0) {
    const modeLabel = (m: string) =>
      m === 'cut' ? 'Cut' : m === 'engrave' ? 'Engrave' : m === 'score' ? 'Score' : m === 'image' ? 'Image' : m;
    const lines = outputLayers.map(layer => {
      const label = modeLabel(layer.settings.mode);
      const p = layer.settings.passes;
      const passWord = p === 1 ? '1 pass' : `${p} passes`;
      return `${label}: "${layer.name}" — ${layer.settings.power.max}% power, ${layer.settings.speed} mm/min, ${passWord}`;
    });
    out.push({
      severity: 'info',
      code: PREFLIGHT_CODES.LAYER_OUTPUT_SUMMARIES,
      message: `Layer laser settings (output layers). ${lines.join('\n')}`,
    });
  }
}

export function runSceneChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const hasObjects = ctx.scene.objects.length > 0;
  if (!hasObjects) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.SCENE_EMPTY,
      message: 'Scene has no objects. Add shapes or import a file first.',
    });
    return;
  }

  // T1-107: this is an output-for-job check, not just canvas visibility.
  // Guide layers (output:false) should not satisfy it because they will
  // not produce burn output.
  const hasOutputObjects = ctx.scene.objects.some(obj => {
    if (!obj.visible) return false;
    const layer = ctx.scene.layers.find(l => l.id === obj.layerId);
    return !!layer && layer.visible !== false && layer.output !== false;
  });
  if (!hasOutputObjects) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.NO_VISIBLE_LAYERS,
      message: 'No visible layers contain objects. Enable a layer with content.',
    });
  }

  for (const layer of ctx.scene.layers) {
    const layerObjects = ctx.scene.objects.filter(obj => obj.layerId === layer.id);
    if (layer.visible === false && layerObjects.length > 0) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.HIDDEN_LAYER_HAS_OBJECTS,
        message: `Layer "${layer.name}" is hidden but contains ${layerObjects.length} object(s). They will not be burned.`,
        layerId: layer.id,
      });
    }
    if (layer.visible !== false && layerObjects.length === 0) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.EMPTY_LAYER,
        message: `Layer "${layer.name}" is visible but empty.`,
        layerId: layer.id,
      });
    }
  }
}
