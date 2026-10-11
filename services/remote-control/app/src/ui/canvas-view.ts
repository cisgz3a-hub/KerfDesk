import { useMemo } from 'react';
import { artworkBox, unionBox, type Box } from '../core/scene';
import type { Preview, View } from '../core/store';
import { useApp } from './hooks';

/** Width the floating tool rail covers on the left of an editable canvas. */
export const RAIL_INSET = 60;

/** Fits `box` into the visible area right of `left` pixels (the tool rail), centred. */
export function fitView(box: Box, width: number, height: number, padding = 28, left = 0): View {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const usable = Math.max(1, width - left);
  const scale = Math.max(0.05, Math.min((usable - padding * 2) / w, (height - padding * 2) / h));
  return {
    scale,
    x: (box.minX + box.maxX) / 2 - (left + usable / 2) / scale,
    y: (box.minY + box.maxY) / 2 - height / (2 * scale),
  };
}

export function useContentBox(): Box {
  const scene = useApp((state) => state.scene);
  const artwork = useApp((state) => state.workspace?.artwork);
  return useMemo(() => {
    const bed = scene?.bed;
    const boxes: Box[] = [];
    if (bed !== undefined) boxes.push({ minX: 0, minY: 0, maxX: bed.widthMm, maxY: bed.heightMm });
    for (const item of artwork ?? []) {
      const box = artworkBox(item);
      if (box !== null) boxes.push(box);
    }
    return unionBox(boxes) ?? { minX: 0, minY: 0, maxX: 300, maxY: 200 };
  }, [scene?.bed, artwork]);
}

export function previewTransform(preview: Preview | null, id: string): string | undefined {
  if (preview === null || !preview.ids.includes(id)) return undefined;
  if (preview.kind === 'move') return `translate(${preview.dx} ${preview.dy})`;
  if (preview.kind === 'scale')
    return `translate(${preview.ox} ${preview.oy}) scale(${preview.sx} ${preview.sy}) translate(${-preview.ox} ${-preview.oy})`;
  return `rotate(${preview.angle} ${preview.cx} ${preview.cy})`;
}

export function clampScale(scale: number): number {
  return Math.max(0.05, Math.min(400, scale));
}
export function normalize(box: Box): Box {
  return {
    minX: Math.min(box.minX, box.maxX),
    minY: Math.min(box.minY, box.maxY),
    maxX: Math.max(box.minX, box.maxX),
    maxY: Math.max(box.minY, box.maxY),
  };
}
