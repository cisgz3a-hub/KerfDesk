// @vitest-environment node
// ADR-477 acceptance: the headless trace command writes the same bytes the
// app's Multi-File Trace writes for the same image and preset. The app path
// is buildMultiFileTraceExports with the Multi-File dialog's default output,
// its own density reader on the PNG file, and the pixels the browser decode
// hands it (opaque images: the canvas returns the stored samples); the CLI
// path decodes the PNG bytes itself from standard input.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../__fixtures__/perceptual/png';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import { runTraceCli } from '../trace-cli/run-trace-cli';
import { compositeRgbOverWhitePreservingAlpha } from '../trace/image-loader';
import { buildMultiFileTraceExports } from './multi-file-trace-action';
import { DEFAULT_TRACE_PAGE_SETTINGS, tracePageOutput } from './TracePageFields';

type Synthetic = { readonly rgb: Uint8Array; readonly width: number; readonly height: number };

function synthetic(width: number, height: number, ink: (x: number, y: number) => boolean) {
  const rgb = new Uint8Array(width * height * 3).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ink(x, y)) rgb.fill(20, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return { rgb, width, height };
}

// A ring with a bar through it, a filled disc, and a stroked zigzag: holes,
// curves, corners and thin lines.
const RING = synthetic(96, 80, (x, y) => {
  const r = Math.hypot(x - 48, y - 40);
  return (r > 18 && r < 30) || (y > 37 && y < 43 && x > 8 && x < 88);
});
const DISC = synthetic(72, 72, (x, y) => Math.hypot(x - 36, y - 36) < 24);
const ZIGZAG = synthetic(90, 60, (x, y) => Math.abs(((x / 15) % 2) * 20 + 15 - y) < 2.5);

function rgba(image: Synthetic): RawImageData {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.width * image.height; i += 1) {
    data.set(image.rgb.subarray(i * 3, i * 3 + 3), i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function appSvg(image: Synthetic, png: Uint8Array, preset: string): Promise<string> {
  const batch = await buildMultiFileTraceExports([new File([new Uint8Array(png)], 'art.png')], {
    loadImage: async () => compositeRgbOverWhitePreservingAlpha(rgba(image)),
    trace: traceImageToColoredPaths,
    ...(TRACE_PRESETS[preset] === undefined ? {} : { options: TRACE_PRESETS[preset] }),
    output: {
      format: 'svg',
      groupContours: false,
      precisionMm: DEFAULT_EXPORT_PRECISION_MM,
      ...tracePageOutput(DEFAULT_TRACE_PAGE_SETTINGS),
    },
  });
  const text = batch.files[0]?.text;
  if (text === undefined) throw new Error(`The app traced nothing for ${preset}.`);
  return text;
}

async function cliSvg(png: Uint8Array, preset: string): Promise<string> {
  let out = '';
  const code = await runTraceCli(['--preset', preset, '--format', 'svg', '-'], {
    readInput: async (path) => {
      expect(path).toBeNull();
      return png;
    },
    writeOutput: async (_path, text) => {
      out += text;
    },
    writeError: (text) => {
      throw new Error(text);
    },
  });
  expect(code).toBe(0);
  return out;
}

describe('trace command parity with the app (ADR-477)', () => {
  it.each([
    ['Line Art', RING],
    ['Smooth', DISC],
    ['Centerline', ZIGZAG],
  ] as const)(
    'writes the SVG the app writes for %s',
    { timeout: 60_000 },
    async (preset, image) => {
      const png = encodeRgbPng(image.rgb, image.width, image.height);
      const app = await appSvg(image, png, preset);
      const cli = await cliSvg(png, preset);
      expect(app).toContain('<path');
      expect(sha256(cli)).toBe(sha256(app));
    },
  );
});
