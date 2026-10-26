import { useEffect } from 'react';
import type { Vec2 } from '../../../../core/scene';
import type { LoadedImage } from './use-outline-photo-session';

export type PhotoOutlineMarks = {
  readonly points: ReadonlyArray<Vec2>;
  readonly anchors: ReadonlyArray<number>;
  /** The two anchors the head captures, in order, when the outline is complete. */
  readonly captureOrder: readonly [number, number] | null;
  /** The point picked as the start of an edge being straightened. */
  readonly selected: number | null;
};

export function usePhotoCanvas(
  ref: React.RefObject<HTMLCanvasElement>,
  image: LoadedImage | null,
  marks: PhotoOutlineMarks,
): void {
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || image === null) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);
    const display = photoDisplaySize(image.width, image.height);
    const scale = image.width / display.width;
    context.font = `bold ${12 * scale}px system-ui, sans-serif`;
    drawOutline(context, marks, scale, canvasColors(canvas));
  }, [image, marks, ref]);
}

export function photoDisplaySize(
  imageW: number,
  imageH: number,
  maxW = 860,
  maxH = 560,
): { readonly width: number; readonly height: number } {
  if (!(imageW > 0) || !(imageH > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxW / imageW, maxH / imageH);
  return { width: imageW * scale, height: imageH * scale };
}

type CanvasColors = {
  readonly line: string;
  readonly point: string;
  readonly capture: string;
  readonly label: string;
};

function canvasColors(canvas: HTMLCanvasElement): CanvasColors {
  const styles = getComputedStyle(canvas);
  const color = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  // Points sit on photo pixels of any colour: white discs with dark labels read
  // on light and dark wood alike, whatever the app theme.
  return {
    line: color('--lf-accent', 'darkorange'),
    point: 'white',
    capture: color('--lf-warning', 'gold'),
    label: 'black',
  };
}

function drawOutline(
  context: CanvasRenderingContext2D,
  marks: PhotoOutlineMarks,
  scale: number,
  colors: CanvasColors,
): void {
  const { points } = marks;
  if (points.length === 0) return;
  context.lineWidth = 2.5 * scale;
  context.strokeStyle = colors.line;
  context.beginPath();
  points.forEach((point, index) =>
    index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
  );
  context.stroke();
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length >= 3 && first !== undefined && last !== undefined) {
    // The closing edge is implied; dash it so the operator sees where it runs.
    context.setLineDash([6 * scale, 5 * scale]);
    context.beginPath();
    context.moveTo(last.x, last.y);
    context.lineTo(first.x, first.y);
    context.stroke();
    context.setLineDash([]);
  }
  drawSelection(context, marks, scale, colors);
  points.forEach((point, index) =>
    drawPoint(context, point, pointLabel(marks, index), scale, colors),
  );
}

function drawSelection(
  context: CanvasRenderingContext2D,
  marks: PhotoOutlineMarks,
  scale: number,
  colors: CanvasColors,
): void {
  const selected = marks.selected === null ? undefined : marks.points[marks.selected];
  if (selected === undefined) return;
  context.strokeStyle = colors.capture;
  context.lineWidth = 3 * scale;
  context.beginPath();
  context.arc(selected.x, selected.y, 14 * scale, 0, Math.PI * 2);
  context.stroke();
}

function pointLabel(marks: PhotoOutlineMarks, index: number): { text: string; capture: boolean } {
  const capture = marks.captureOrder?.indexOf(index) ?? -1;
  if (capture === 0) return { text: 'A', capture: true };
  if (capture === 1) return { text: 'B', capture: true };
  return { text: String(index + 1), capture: false };
}

function drawPoint(
  context: CanvasRenderingContext2D,
  point: Vec2,
  label: { readonly text: string; readonly capture: boolean },
  scale: number,
  colors: CanvasColors,
): void {
  context.fillStyle = label.capture ? colors.capture : colors.point;
  context.strokeStyle = colors.line;
  context.lineWidth = 2 * scale;
  context.beginPath();
  context.arc(point.x, point.y, 8 * scale, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = colors.label;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label.text, point.x, point.y);
}
