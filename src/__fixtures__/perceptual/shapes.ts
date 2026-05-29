// Perceptual test harness — synthetic source fixtures with analytic truth.
//
// Each fixture is a black-on-white bitmap whose inked region is defined by a
// closed-form predicate, sampled at pixel centres. The SAME predicate fills
// both the source image (what the tracer sees) and the ground-truth mask
// (what a perfect trace+fill must reproduce). So the truth is not a guess or
// a stored golden file — it is, by construction, exactly the set of black
// pixels in the source. IoU then measures how faithfully the trace pipeline
// re-inks those pixels.
//
// Shapes are chosen to probe known weak spots: a solid square (baseline a
// tracer should nail), a filled disc (curved boundary), a ring and a square
// glyph (hole topology — the "letter O must stay hollow" case), and a thin
// plus (narrow strokes, where outline tracers tend to double the contour).
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { RawImageData } from '../../core/trace';
import { createMask } from './rasterize';
import type { Mask } from './rasterize';

export type PerceptualFixture = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly image: RawImageData; // black-on-white source for the tracer
  readonly truth: Mask; // 1 wherever the source is inked
};

// A point-in-shape test. Coordinates are pixel-centre samples (x+0.5, y+0.5).
type InkAt = (sx: number, sy: number) => boolean;

const RGBA_CHANNELS = 4;
const INK = 0; // black
const PAPER = 255; // white
const OPAQUE = 255;

function renderFixture(name: string, size: number, inkAt: InkAt): PerceptualFixture {
  const data = new Uint8ClampedArray(size * size * RGBA_CHANNELS);
  const truth = createMask(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inked = inkAt(x + 0.5, y + 0.5);
      const base = (y * size + x) * RGBA_CHANNELS;
      const value = inked ? INK : PAPER;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = OPAQUE;
      if (inked) truth.data[y * size + x] = 1;
    }
  }
  return { name, width: size, height: size, image: { width: size, height: size, data }, truth };
}

function disc(cx: number, cy: number, r: number): InkAt {
  return (x, y) => Math.hypot(x - cx, y - cy) <= r;
}

function ring(cx: number, cy: number, outerR: number, innerR: number): InkAt {
  return (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= outerR && d >= innerR;
  };
}

function rect(x0: number, y0: number, x1: number, y1: number): InkAt {
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function plus(cx: number, cy: number, halfWidth: number, armLength: number): InkAt {
  return (x, y) => {
    const inVertical = Math.abs(x - cx) <= halfWidth && Math.abs(y - cy) <= armLength;
    const inHorizontal = Math.abs(y - cy) <= halfWidth && Math.abs(x - cx) <= armLength;
    return inVertical || inHorizontal;
  };
}

function squareWithHole(inset: number, wall: number, size: number): InkAt {
  const outer = rect(inset, inset, size - inset, size - inset);
  const hole = rect(inset + wall, inset + wall, size - inset - wall, size - inset - wall);
  return (x, y) => outer(x, y) && !hole(x, y);
}

const SIZE = 128;
const CENTER = SIZE / 2;

export const PERCEPTUAL_FIXTURES: ReadonlyArray<PerceptualFixture> = [
  renderFixture('solid-square', SIZE, rect(32, 32, 96, 96)),
  renderFixture('filled-disc', SIZE, disc(CENTER, CENTER, 48)),
  renderFixture('ring-annulus', SIZE, ring(CENTER, CENTER, 50, 26)),
  renderFixture('plus-stroke', SIZE, plus(CENTER, CENTER, 8, 48)),
  renderFixture('square-glyph', SIZE, squareWithHole(28, 24, SIZE)),
];
