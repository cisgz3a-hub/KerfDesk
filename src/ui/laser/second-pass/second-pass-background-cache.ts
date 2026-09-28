/* eslint-disable no-restricted-syntax -- These colours describe the engraving canvas, not UI chrome. */
import type { CanvasSize, CanvasView } from './second-pass-canvas-view';
import type { SecondPassDrawing } from './second-pass-preview';
import { drawSecondPassSegments } from './second-pass-render-paths';

export const SECOND_PASS_REDRAW_DELAY_MS = 150;
const CACHE_SEGMENT_THRESHOLD = 25_000;
type Scene = {
  drawing: SecondPassDrawing;
  preview: SecondPassDrawing | null;
  showPreview: boolean;
};
type Snapshot = Scene & {
  bitmap: HTMLCanvasElement;
  view: CanvasView;
  size: CanvasSize;
  ratio: number;
};

export function secondPassCanvasContext(
  canvas: HTMLCanvasElement,
  size: CanvasSize,
): CanvasRenderingContext2D | null {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(size.width * ratio));
  const height = Math.max(1, Math.round(size.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(size.width > 0 ? width / size.width : 1, size.height > 0 ? height / size.height : 1);
  return ctx;
}

/** Reuse only display pixels while the view moves. The settled view is always
 * rebuilt from the original binary64 endpoints, never from the bitmap. */
export class SecondPassBackgroundCache {
  private snapshot: Snapshot | null = null;

  draw(
    canvas: HTMLCanvasElement,
    scene: Scene,
    view: CanvasView,
    size: CanvasSize,
    exact = false,
  ): 'cached' | 'exact' {
    const ctx = secondPassCanvasContext(canvas, size);
    if (!ctx) return 'exact';
    ctx.fillStyle = '#faf7ef';
    ctx.fillRect(0, 0, size.width, size.height);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const previous = this.snapshot;
    if (!exact && previous && sameScene(previous, scene, size, ratio)) {
      const scale = view.scale / previous.view.scale;
      ctx.drawImage(
        previous.bitmap,
        view.x - previous.view.x * scale,
        view.y - previous.view.y * scale,
        size.width * scale,
        size.height * scale,
      );
      return sameView(previous.view, view) ? 'exact' : 'cached';
    }
    paintScene(ctx, scene, view, size);
    if (!denseScene(scene)) {
      this.snapshot = null;
      return 'exact';
    }
    const bitmap = previous?.bitmap ?? document.createElement('canvas');
    bitmap.width = canvas.width;
    bitmap.height = canvas.height;
    bitmap.getContext('2d')?.drawImage(canvas, 0, 0);
    this.snapshot = { ...scene, bitmap, view: { ...view }, size: { ...size }, ratio };
    return 'exact';
  }
}

function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: CanvasView,
  size: CanvasSize,
): void {
  drawSecondPassSegments(ctx, scene.drawing, view, size, scene.showPreview ? 0.16 : 1);
  if (scene.showPreview && scene.preview)
    drawSecondPassSegments(ctx, scene.preview, view, size, 1, '#b64214');
}

function denseScene(scene: Scene): boolean {
  const segments =
    scene.drawing.segments.length / 5 +
    (scene.showPreview && scene.preview ? scene.preview.segments.length / 5 : 0);
  return segments >= CACHE_SEGMENT_THRESHOLD;
}

function sameScene(previous: Snapshot, scene: Scene, size: CanvasSize, ratio: number): boolean {
  return (
    previous.drawing === scene.drawing &&
    previous.preview === scene.preview &&
    previous.showPreview === scene.showPreview &&
    previous.size.width === size.width &&
    previous.size.height === size.height &&
    previous.ratio === ratio
  );
}

function sameView(a: CanvasView, b: CanvasView): boolean {
  return a.x === b.x && a.y === b.y && a.scale === b.scale;
}
