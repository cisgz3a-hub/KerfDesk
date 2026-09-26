// Test support (ADR-441): render what a known camera sees of the engraved bed
// target on a cardboard sheet lying on a honeycomb bed. Every pixel is
// back-projected through the real camera model, so a detector or fit that
// recovers the camera from this frame recovers it from geometry, not from a
// shortcut. Not shipped code.

import type { GrayImage } from '../corner-subpix';
import { bedMapper, type CameraPose, type LensModel, type Vec2 } from '../model/camera-model';
import type { BedTargetArea, BedTargetLayout } from './bed-target';

export type TargetScene = {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly layout: BedTargetLayout;
  /** The cardboard sheet the target sits on, bed mm. */
  readonly sheet: BedTargetArea;
  readonly sheetThicknessMm: number;
  /** Grey-level noise standard deviation. */
  readonly noise?: number;
  /** Honeycomb cell pitch, mm (0 for a plain bed). */
  readonly honeycombPitchMm?: number;
};

const SHEET_GREY = 196;
const MARK_GREY = 58;
const HONEYCOMB_WALL = 170;
const HONEYCOMB_HOLE = 34;
const SUPERSAMPLE = 2;

export function renderTargetScene(scene: TargetScene): GrayImage {
  const { imageWidth: width, imageHeight: height } = scene.lens;
  const data = new Float32Array(width * height);
  const toBed = bedMapper(scene.lens, scene.pose);
  let seed = 12345;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const px = x - 0.5 + (sx + 0.5) / SUPERSAMPLE;
          const py = y - 0.5 + (sy + 0.5) / SUPERSAMPLE;
          sum += shade(scene, toBed, px, py);
        }
      }
      const noise = (scene.noise ?? 0) * gaussian(random);
      const vignette =
        1 - 0.3 * (((x - width / 2) / width) ** 2 + ((y - height / 2) / height) ** 2) * 2;
      data[y * width + x] = Math.max(0, Math.min(255, (sum / SUPERSAMPLE ** 2) * vignette + noise));
    }
  }
  return { data, width, height };
}

type ToBed = (pixel: Vec2, heightMm?: number) => Vec2 | null;

function shade(scene: TargetScene, toBed: ToBed, px: number, py: number): number {
  const onSheet = toBed({ x: px, y: py }, scene.sheetThicknessMm);
  if (onSheet !== null && inside(scene.sheet, onSheet.x, onSheet.y)) {
    return markShade(scene.layout, onSheet.x, onSheet.y);
  }
  const onBed = toBed({ x: px, y: py }, 0);
  if (onBed === null) return HONEYCOMB_HOLE;
  return honeycombShade(scene.honeycombPitchMm ?? 6, onBed.x, onBed.y);
}

function markShade(layout: BedTargetLayout, x: number, y: number): number {
  const outer = layout.ringDiameterMm / 2;
  const inner = outer - layout.ringWidthMm;
  const first = layout.marks[0];
  if (first === undefined) return SHEET_GREY;
  // Marks sit on a regular grid, so the only candidate is the nearest node.
  const col = Math.round((x - first.x) / layout.spacingMm);
  const row = Math.round((y - first.y) / layout.spacingMm);
  const mark = layout.marks.find((m) => m.col === first.col + col && m.row === first.row + row);
  if (mark === undefined) return SHEET_GREY;
  const d = Math.hypot(x - mark.x, y - mark.y);
  if (d > outer) return SHEET_GREY;
  return d >= inner || mark.anchor ? MARK_GREY : SHEET_GREY;
}

// Hexagonal holes separated by thin bright walls.
function honeycombShade(pitch: number, x: number, y: number): number {
  if (pitch <= 0) return HONEYCOMB_WALL;
  const rowHeight = (pitch * Math.sqrt(3)) / 2;
  const row = Math.round(y / rowHeight);
  const offset = row % 2 === 0 ? 0 : pitch / 2;
  const col = Math.round((x - offset) / pitch);
  const d = Math.hypot(x - (col * pitch + offset), y - row * rowHeight);
  return d < pitch * 0.42 ? HONEYCOMB_HOLE : HONEYCOMB_WALL;
}

function inside(area: BedTargetArea, x: number, y: number): boolean {
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}

function gaussian(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
}
