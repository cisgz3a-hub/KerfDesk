import type { PlatformAdapter } from '../../platform/types';
import type { Layer, Project, RasterImage, SceneObject } from '../../core/scene';
import { evaluateRasterBudget } from '../../core/raster';
import { buildProcessedRasterBitmap, processedRasterDimensions } from '../raster/processed-bitmap';
import { rgbaToPngBlob } from '../raster/luma-bitmap';
import type { ToastVariant } from '../state/toast-store';

const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

type PngEncoder = (
  rgba: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
) => Promise<Blob>;

export type SaveProcessedBitmapCtx = {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly encodePng?: PngEncoder;
};

export async function handleSaveProcessedBitmap(ctx: SaveProcessedBitmapCtx): Promise<void> {
  const selected = selectedRaster(ctx.project, ctx.selectedObjectId);
  if (selected === null) {
    ctx.pushToast('Select an image before saving a processed bitmap.', 'error');
    return;
  }
  const layer = layerForRaster(ctx.project, selected);
  if (layer === null || layer.mode !== 'image' || !layer.output) {
    ctx.pushToast('The selected image needs an enabled Image layer before export.', 'error');
    return;
  }
  const { width, height } = processedRasterDimensions(selected, layer);
  const budget = evaluateRasterBudget(width, height);
  if (budget.kind === 'too-large') {
    ctx.pushToast(`Could not save processed bitmap: ${budget.reason}`, 'error');
    return;
  }
  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: suggestedProcessedBitmapName(selected.source),
      extensions: ['.png'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save processed bitmap: ${errMsg(err)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    const bitmap = buildProcessedRasterBitmap(selected, layer, ctx.project.device, {
      maskObject: imageMaskObjectFor(ctx.project, selected),
    });
    if (bitmap.kind === 'too-large') {
      ctx.pushToast(`Could not save processed bitmap: ${bitmap.reason}`, 'error');
      return;
    }
    const encode = ctx.encodePng ?? rgbaToPngBlob;
    await target.write(await encode(bitmap.rgba, bitmap.width, bitmap.height));
    ctx.pushToast(`Saved processed bitmap to ${target.displayName}`, 'success');
  } catch (err) {
    ctx.pushToast(`Could not save processed bitmap: ${errMsg(err)}`, 'error');
  }
}

function selectedRaster(project: Project, selectedObjectId: string | null): RasterImage | null {
  if (selectedObjectId === null) return null;
  const selected = project.scene.objects.find((object) => object.id === selectedObjectId);
  return selected?.kind === 'raster-image' ? selected : null;
}

function layerForRaster(project: Project, image: RasterImage): Layer | null {
  return project.scene.layers.find((layer) => layer.color === image.color) ?? null;
}

function imageMaskObjectFor(project: Project, image: RasterImage): SceneObject | null {
  if (image.imageMaskId === undefined) return null;
  return project.scene.objects.find((object) => object.id === image.imageMaskId) ?? null;
}

function suggestedProcessedBitmapName(source: string): string {
  const filename = source.split(/[/\\]/).pop() ?? source;
  const stem = sanitizeFilenameStem(filename.replace(/\.[^.]*$/, ''));
  const safeStem = stem.trim() === '' ? 'processed-image' : stem.trim();
  return `${safeStem}-processed.png`;
}

function sanitizeFilenameStem(stem: string): string {
  let out = '';
  for (const char of stem) {
    out += isSafeFilenameChar(char) ? char : '-';
  }
  return out;
}

function isSafeFilenameChar(char: string): boolean {
  if (char.charCodeAt(0) < 32) return false;
  return !FORBIDDEN_FILENAME_CHARS.has(char);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
