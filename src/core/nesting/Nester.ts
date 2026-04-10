/**
 * Shape nesting / auto-layout — packs scene objects efficiently onto material
 * using a bin-packing algorithm. Reduces material waste by automatically
 * arranging shapes to minimize space.
 *
 * Uses a "Maximal Rectangles" bin packing algorithm with bottom-left placement.
 * This is the same family of algorithms LightBurn and Deepnest use.
 */

import { type SceneObject } from '../scene/SceneObject';
import { computeObjectBounds } from '../../geometry/bounds';

export interface NestingOptions {
  binWidth: number; // Material width in mm
  binHeight: number; // Material height in mm
  /** World-space top-left of the bin (e.g. material.x, material.y). */
  binOriginX?: number;
  binOriginY?: number;
  padding: number; // Spacing between shapes (kerf + safety)
  edgeMargin: number; // Distance from material edge
  rotationAllowed: boolean; // Allow 90° rotation for better packing
  sortMode: 'area' | 'height' | 'width' | 'longest';
}

export interface NestedItem {
  objectId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
}

export interface NestingResult {
  items: NestedItem[];
  unplaced: string[]; // Object IDs that didn't fit
  efficiency: number; // 0-1, how much of the material is used
  binsUsed: number; // For future multi-sheet support
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ShapeBox {
  id: string;
  width: number;
  height: number;
  area: number;
  longest: number;
}

/**
 * Pack shapes into a bin using maximal rectangles algorithm.
 * Returns the optimal positions for each shape.
 */
export function nestShapes(
  objects: SceneObject[],
  options: NestingOptions,
): NestingResult {
  const {
    binWidth,
    binHeight,
    padding,
    edgeMargin,
    rotationAllowed,
    sortMode,
    binOriginX = 0,
    binOriginY = 0,
  } = options;

  // Compute bounding box for each object
  const boxes: ShapeBox[] = [];
  for (const obj of objects) {
    if (!obj.visible || obj.locked) continue;
    const bounds = computeObjectBounds(obj);
    if (!bounds) continue;
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    if (w <= 0 || h <= 0) continue;
    boxes.push({
      id: obj.id,
      width: w + padding * 2, // Add padding around each shape
      height: h + padding * 2,
      area: w * h,
      longest: Math.max(w, h),
    });
  }

  // Sort shapes by chosen criterion (largest first for best packing)
  switch (sortMode) {
    case 'area':
      boxes.sort((a, b) => b.area - a.area);
      break;
    case 'height':
      boxes.sort((a, b) => b.height - a.height);
      break;
    case 'width':
      boxes.sort((a, b) => b.width - a.width);
      break;
    case 'longest':
      boxes.sort((a, b) => b.longest - a.longest);
      break;
  }

  // Available area inside the bin (after edge margin)
  const usableWidth = binWidth - edgeMargin * 2;
  const usableHeight = binHeight - edgeMargin * 2;

  // Free rectangles list — starts with the entire usable area (world space)
  const freeRects: FreeRect[] = [
    {
      x: binOriginX + edgeMargin,
      y: binOriginY + edgeMargin,
      width: usableWidth,
      height: usableHeight,
    },
  ];

  const placed: NestedItem[] = [];
  const unplaced: string[] = [];

  for (const box of boxes) {
    // Try to find best free rectangle for this shape
    let bestRect: FreeRect | null = null;
    let bestScore = Infinity;
    let bestRotated = false;

    for (const rect of freeRects) {
      // Try without rotation
      if (box.width <= rect.width && box.height <= rect.height) {
        // Bottom-left score: lower y first, then lower x
        const score = rect.y * 10000 + rect.x;
        if (score < bestScore) {
          bestScore = score;
          bestRect = rect;
          bestRotated = false;
        }
      }
      // Try with 90° rotation
      if (rotationAllowed && box.height <= rect.width && box.width <= rect.height) {
        const score = rect.y * 10000 + rect.x;
        if (score < bestScore) {
          bestScore = score;
          bestRect = rect;
          bestRotated = true;
        }
      }
    }

    if (!bestRect) {
      unplaced.push(box.id);
      continue;
    }

    // Place the shape
    const placedW = bestRotated ? box.height : box.width;
    const placedH = bestRotated ? box.width : box.height;

    placed.push({
      objectId: box.id,
      x: bestRect.x + padding, // Account for padding offset (world space)
      y: bestRect.y + padding,
      width: placedW - padding * 2,
      height: placedH - padding * 2,
      rotated: bestRotated,
    });

    // Split the free rectangle into smaller rectangles
    const newFreeRects: FreeRect[] = [];

    for (const rect of freeRects) {
      // If this rect doesn't overlap the placed shape, keep it
      if (
        bestRect.x + placedW <= rect.x ||
        bestRect.y + placedH <= rect.y ||
        bestRect.x >= rect.x + rect.width ||
        bestRect.y >= rect.y + rect.height
      ) {
        newFreeRects.push(rect);
        continue;
      }

      // Split into up to 4 sub-rectangles around the placed shape
      // Right of placed shape
      if (bestRect.x + placedW < rect.x + rect.width) {
        newFreeRects.push({
          x: bestRect.x + placedW,
          y: rect.y,
          width: rect.x + rect.width - (bestRect.x + placedW),
          height: rect.height,
        });
      }
      // Left of placed shape
      if (bestRect.x > rect.x) {
        newFreeRects.push({
          x: rect.x,
          y: rect.y,
          width: bestRect.x - rect.x,
          height: rect.height,
        });
      }
      // Above placed shape
      if (bestRect.y + placedH < rect.y + rect.height) {
        newFreeRects.push({
          x: rect.x,
          y: bestRect.y + placedH,
          width: rect.width,
          height: rect.y + rect.height - (bestRect.y + placedH),
        });
      }
      // Below placed shape
      if (bestRect.y > rect.y) {
        newFreeRects.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: bestRect.y - rect.y,
        });
      }
    }

    // Remove rectangles fully contained within other rectangles
    freeRects.length = 0;
    for (let i = 0; i < newFreeRects.length; i++) {
      let contained = false;
      for (let j = 0; j < newFreeRects.length; j++) {
        if (i === j) continue;
        const a = newFreeRects[i];
        const b = newFreeRects[j];
        if (
          a.x >= b.x &&
          a.y >= b.y &&
          a.x + a.width <= b.x + b.width &&
          a.y + a.height <= b.y + b.height
        ) {
          contained = true;
          break;
        }
      }
      if (!contained) {
        freeRects.push(newFreeRects[i]);
      }
    }
  }

  // Calculate packing efficiency
  const totalShapeArea = placed.reduce((sum, p) => sum + p.width * p.height, 0);
  const totalBinArea = usableWidth * usableHeight;
  const efficiency = totalBinArea > 0 ? totalShapeArea / totalBinArea : 0;

  return {
    items: placed,
    unplaced,
    efficiency,
    binsUsed: 1,
  };
}

/**
 * Apply a nesting result to the scene by updating object transforms.
 * Each object's bounding box top-left corner is moved to its nested position.
 */
export function applyNesting(
  objects: SceneObject[],
  result: NestingResult,
): SceneObject[] {
  const updates = new Map<string, NestedItem>();
  for (const item of result.items) {
    updates.set(item.objectId, item);
  }

  return objects.map(obj => {
    const item = updates.get(obj.id);
    if (!item) return obj;

    // Compute current bounds to determine offset needed
    const bounds = computeObjectBounds(obj);
    if (!bounds) return obj;

    // Calculate translation needed to move bounds.minX/minY to item.x/item.y
    const dx = item.x - bounds.minX;
    const dy = item.y - bounds.minY;

    let newTransform = {
      ...obj.transform,
      tx: obj.transform.tx + dx,
      ty: obj.transform.ty + dy,
    };

    // If rotated, apply 90° rotation around the new top-left corner
    if (item.rotated) {
      const rad = Math.PI / 2;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Rotate around bounds center
      const cx = bounds.minX + (bounds.maxX - bounds.minX) / 2 + dx;
      const cy = bounds.minY + (bounds.maxY - bounds.minY) / 2 + dy;
      const t = newTransform;

      const newA = cos * t.a - sin * t.c;
      const newB = cos * t.b - sin * t.d;
      const newC = sin * t.a + cos * t.c;
      const newD = sin * t.b + cos * t.d;
      const newTx = cos * (t.tx - cx) - sin * (t.ty - cy) + cx;
      const newTy = sin * (t.tx - cx) + cos * (t.ty - cy) + cy;

      newTransform = { a: newA, b: newB, c: newC, d: newD, tx: newTx, ty: newTy };
    }

    return {
      ...obj,
      transform: newTransform,
      _bounds: null,
      _worldTransform: null,
    };
  });
}
