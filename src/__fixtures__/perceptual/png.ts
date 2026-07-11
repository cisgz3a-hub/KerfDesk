// Perceptual test harness — opt-in PNG artifact dump.
//
// A green test that prints "IoU=0.97" is still invisible: you can't SEE
// what the trace produced. When the env var PERCEPTUAL_ARTIFACTS is set,
// the perceptual test writes a side-by-side PNG per fixture —
// [ground truth | predicted | diff] — into ./perceptual-artifacts/ so a
// human can eyeball the result. Off by default, so normal `pnpm test`
// runs write nothing.
//
// Diff panel legend: green = correct ink (TP), red = spurious ink (FP),
// blue = missed ink (FN), white = correct background (TN).
//
// Self-contained PNG encoder (8-bit RGB, no filtering, single IDAT via
// node:zlib). Test-only helper under src/__fixtures__ — boundary- and
// coverage-exempt, and free to touch node:fs / node:zlib / process.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Mask } from './rasterize';

const ARTIFACT_ENV = 'PERCEPTUAL_ARTIFACTS';
const ARTIFACT_DIR = 'perceptual-artifacts';
const CHANNELS = 3; // RGB
const PANEL_GAP = 2; // white columns between the three panels

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const TP_GREEN: Rgb = [0, 160, 0];
const FP_RED: Rgb = [220, 0, 0];
const FN_BLUE: Rgb = [0, 0, 220];

// Write a comparison PNG iff PERCEPTUAL_ARTIFACTS is set. Returns the file
// path written, or null when the dump is disabled. Never throws on a
// disabled run, so callers can call it unconditionally.
export function writePerceptualArtifact(name: string, predicted: Mask, truth: Mask): string | null {
  const flag = process.env[ARTIFACT_ENV];
  if (flag === undefined || flag === '') return null;
  assertSameMaskDimensions(predicted, truth);
  const composite = buildComparison(predicted, truth);
  const png = encodePng(composite.rgb, composite.width, composite.height);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = join(ARTIFACT_DIR, `${name}.png`);
  writeFileSync(path, png);
  return path;
}

function assertSameMaskDimensions(predicted: Mask, truth: Mask): void {
  if (predicted.width === truth.width && predicted.height === truth.height) return;
  throw new Error(
    `mask size mismatch: ${predicted.width}x${predicted.height} vs ${truth.width}x${truth.height}`,
  );
}

function buildComparison(
  predicted: Mask,
  truth: Mask,
): { readonly rgb: Uint8Array; readonly width: number; readonly height: number } {
  const w = truth.width;
  const h = truth.height;
  const panelCount = 3;
  const totalW = w * panelCount + PANEL_GAP * (panelCount - 1);
  const rgb = new Uint8Array(totalW * h * CHANNELS).fill(255); // white incl. gaps
  const panelX = [0, w + PANEL_GAP, 2 * (w + PANEL_GAP)];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = (truth.data[y * w + x] ?? 0) === 1;
      const p = (predicted.data[y * w + x] ?? 0) === 1;
      setPixel(rgb, totalW, (panelX[0] ?? 0) + x, y, t ? BLACK : WHITE);
      setPixel(rgb, totalW, (panelX[1] ?? 0) + x, y, p ? BLACK : WHITE);
      setPixel(rgb, totalW, (panelX[2] ?? 0) + x, y, diffColor(p, t));
    }
  }
  return { rgb, width: totalW, height: h };
}

function diffColor(predicted: boolean, truth: boolean): Rgb {
  if (predicted && truth) return TP_GREEN;
  if (predicted) return FP_RED;
  if (truth) return FN_BLUE;
  return WHITE;
}

function setPixel(rgb: Uint8Array, width: number, x: number, y: number, color: Rgb): void {
  const base = (y * width + x) * CHANNELS;
  rgb[base] = color[0];
  rgb[base + 1] = color[1];
  rgb[base + 2] = color[2];
}

// --- minimal PNG encoder ---------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Exported so other perceptual harness modules (e.g. region-crop dumps) can
// write raw RGB buffers without duplicating a third PNG encoder copy.
export function encodeRgbPng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  return encodePng(rgb, width, height);
}

function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * CHANNELS;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    raw.set(rgb.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])));
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
