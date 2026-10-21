import { useEffect } from 'react';
import { applyHomography, invertMat3, type Mat3 } from '../../../../core/camera/homography';
import type { Vec2 } from '../../../../core/scene';

type LoadedImage = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

export function usePhotoCanvas(
  ref: React.RefObject<HTMLCanvasElement>,
  image: LoadedImage | null,
  corners: ReadonlyArray<Vec2>,
  outline: ReadonlyArray<Vec2> | null,
  anchors: ReadonlyArray<number>,
  toMm: Mat3 | null,
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
    const colors = canvasColors(canvas);
    context.font = `${12 * scale}px system-ui, sans-serif`;
    drawCorners(context, corners, scale, colors);
    const inverse = toMm === null ? null : invertMat3(toMm);
    if (outline === null || inverse === null) return;
    drawOutline(
      context,
      outline.map((point) => applyHomography(inverse, point)),
      anchors,
      scale,
      colors,
    );
  }, [anchors, corners, image, outline, ref, toMm]);
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
  readonly warning: string;
  readonly accent: string;
  readonly text: string;
};

function canvasColors(canvas: HTMLCanvasElement): CanvasColors {
  const styles = getComputedStyle(canvas);
  const color = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    warning: color('--lf-warning-fg', 'darkorange'),
    accent: color('--lf-accent', 'deepskyblue'),
    text: color('--lf-text', 'black'),
  };
}

function drawCorners(
  context: CanvasRenderingContext2D,
  corners: ReadonlyArray<Vec2>,
  scale: number,
  colors: CanvasColors,
): void {
  context.fillStyle = colors.warning;
  corners.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, 7 * scale, 0, Math.PI * 2);
    context.fill();
    context.fillText(String(index + 1), point.x + 9 * scale, point.y);
  });
}

function drawOutline(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<Vec2>,
  anchors: ReadonlyArray<number>,
  scale: number,
  colors: CanvasColors,
): void {
  context.strokeStyle = colors.accent;
  context.lineWidth = 3 * scale;
  context.beginPath();
  points.forEach((point, index) =>
    index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
  );
  context.closePath();
  context.stroke();
  anchors.forEach((vertex, ordinal) => {
    const point = points[vertex];
    if (point === undefined) return;
    context.fillStyle = colors.warning;
    context.beginPath();
    context.arc(point.x, point.y, 7 * scale, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = colors.text;
    context.fillText(String(ordinal + 1), point.x - 3 * scale, point.y + 4 * scale);
  });
}
