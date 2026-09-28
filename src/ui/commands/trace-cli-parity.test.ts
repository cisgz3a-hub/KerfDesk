// @vitest-environment node
// ADR-477 acceptance: the headless trace command writes the same bytes the
// app's Multi-File Trace writes for the same image and settings. The app path
// is buildMultiFileTraceExports with the Multi-File dialog's default output,
// its own density reader on the encoded file, its natural-size planning
// branch, and the straight-alpha pixels the file stores composited as the
// browser import composites them; the CLI path decodes the bytes itself from
// standard input. The fixtures vary what the CLI must get right on its own:
// PNG and BMP decoding, embedded density (none, PNG pHYs, BMP pixels per
// metre), a transparent ground whose stored RGB is black, Trace
// transparency, and sparse specks whose first pass finds nothing, so both
// sides must take the app's relaxed-settings retry. The app side keeps its
// own trace function (traceWithWorkerFallback, in-thread under Node).

import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { traceNoticeMessage } from '../trace/trace-notices';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import { runTraceCli } from '../trace-cli/run-trace-cli';
import { compositeRgbOverWhitePreservingAlpha } from '../trace/image-loader';
import {
  mergeLightBurnTraceSettings,
  type LightBurnTraceSettingOverrides,
} from '../trace/trace-options';
import { buildMultiFileTraceExports } from './multi-file-trace-action';
import { DEFAULT_TRACE_PAGE_SETTINGS, tracePageOutput } from './TracePageFields';

const INK = [20, 20, 20, 255] as const;
const PAPER = [255, 255, 255, 255] as const;
// Transparent with black stored RGB, as many exporters write it: traced by
// luma it is paper only once composited onto white.
const CLEAR = [0, 0, 0, 0] as const;

type Pixel = readonly [number, number, number, number];

function synthetic(
  width: number,
  height: number,
  ink: (x: number, y: number) => boolean,
  ground: Pixel = PAPER,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(ink(x, y) ? INK : ground, (y * width + x) * 4);
  }
  return { width, height, data };
}

// A ring with a bar through it, a filled disc, and a stroked zigzag: holes,
// curves, corners and thin lines.
const ringInk = (x: number, y: number): boolean => {
  const r = Math.hypot(x - 48, y - 40);
  return (r > 18 && r < 30) || (y > 37 && y < 43 && x > 8 && x < 88);
};
const RING = synthetic(96, 80, ringInk);
const DISC = synthetic(72, 72, (x, y) => Math.hypot(x - 36, y - 36) < 24);
const ZIGZAG = synthetic(90, 60, (x, y) => Math.abs(((x / 15) % 2) * 20 + 15 - y) < 2.5);
const CLEAR_RING = synthetic(96, 80, ringInk, CLEAR);
// Four 2x2 dots on white: aggressive presets drop them on the first pass.
const SPECKS = synthetic(
  120,
  90,
  (x, y) =>
    [20, 90].some((cx) => x >= cx && x < cx + 2) && [20, 60].some((cy) => y >= cy && y < cy + 2),
);

const DPI_300_PER_METRE = Math.round(300 / 0.0254);

function pngChunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** 8-bit RGBA PNG, with a pHYs chunk when pixels per metre are given. */
function encodePng(image: RawImageData, perMetre?: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const phys = new Uint8Array(9);
  new DataView(phys.buffer).setUint32(0, perMetre ?? 0);
  new DataView(phys.buffer).setUint32(4, perMetre ?? 0);
  phys[8] = 1;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...(perMetre === undefined ? [] : [pngChunk('pHYs', phys)]),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

/** Bottom-up 24-bit BMP of an opaque image, with its pixels per metre. */
function encodeBmp(image: RawImageData, perMetre: number): Uint8Array {
  const stride = Math.ceil((image.width * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + stride * image.height);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, image.width, true);
  view.setInt32(22, image.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setInt32(38, perMetre, true);
  view.setInt32(42, perMetre, true);
  for (let y = 0; y < image.height; y += 1) {
    const row = 54 + (image.height - 1 - y) * stride;
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + x) * 4;
      const [r = 0, g = 0, b = 0] = image.data.subarray(from, from + 3);
      bytes.set([b, g, r], row + x * 3);
    }
  }
  return bytes;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

type Case = {
  readonly preset: string;
  readonly image: RawImageData;
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly overrides?: LightBurnTraceSettingOverrides;
  readonly cliFlags?: ReadonlyArray<string>;
};

type Traced = { readonly text: string; readonly relaxed: boolean };

async function appSvg(test: Case): Promise<Traced> {
  const preset = TRACE_PRESETS[test.preset];
  if (preset === undefined) throw new Error(`No preset ${test.preset}.`);
  const file = new File([new Uint8Array(test.bytes)], test.name);
  const batch = await buildMultiFileTraceExports([file], {
    loadImage: async () => compositeRgbOverWhitePreservingAlpha(test.image),
    readNaturalSize: async () => ({ width: test.image.width, height: test.image.height }),
    options: mergeLightBurnTraceSettings(preset, test.overrides ?? {}),
    output: {
      format: 'svg',
      groupContours: false,
      precisionMm: DEFAULT_EXPORT_PRECISION_MM,
      ...tracePageOutput(DEFAULT_TRACE_PAGE_SETTINGS),
    },
  });
  const file0 = batch.files[0];
  if (file0 === undefined) throw new Error(`The app traced nothing for ${test.preset}.`);
  return { text: file0.text, relaxed: file0.notices?.includes('relaxed-settings') === true };
}

async function cliSvg(test: Case): Promise<Traced> {
  let out = '';
  let errors = '';
  const argv = ['--preset', test.preset, '--format', 'svg', ...(test.cliFlags ?? []), '-'];
  const code = await runTraceCli(argv, {
    readInput: async (path) => {
      expect(path).toBeNull();
      return test.bytes;
    },
    writeOutput: async (_path, text) => {
      out += text;
    },
    writeError: (text) => {
      errors += text;
    },
  });
  expect(code, errors).toBe(0);
  const relaxed = `kerfdesk-trace: warning: ${traceNoticeMessage('relaxed-settings')}\n`;
  expect([relaxed, '']).toContain(errors);
  return { text: out, relaxed: errors === relaxed };
}

const png = (preset: string, image: RawImageData): Case => ({
  preset,
  image,
  bytes: encodePng(image),
  name: 'art.png',
});

describe('trace command parity with the app (ADR-477)', () => {
  it.each([
    ['Line Art', png('Line Art', RING)],
    ['Smooth', png('Smooth', DISC)],
    ['Centerline', png('Centerline', ZIGZAG)],
    [
      'Line Art, PNG pHYs 300 dpi',
      { ...png('Line Art', RING), bytes: encodePng(RING, DPI_300_PER_METRE) },
    ],
    [
      'Line Art, BMP 300 dpi',
      { ...png('Line Art', DISC), bytes: encodeBmp(DISC, DPI_300_PER_METRE), name: 'art.bmp' },
    ],
    ['Line Art, clear ground traced by luma', png('Line Art', CLEAR_RING)],
    [
      'Line Art, Trace transparency',
      {
        ...png('Line Art', CLEAR_RING),
        overrides: { traceTransparency: true },
        cliFlags: ['--trace-transparency'],
      },
    ],
    ['Line Art, sparse specks after a relaxed retry', png('Line Art', SPECKS)],
    ['Smooth, sparse specks after a relaxed retry', png('Smooth', SPECKS)],
    ['Centerline, sparse specks after a relaxed retry', png('Centerline', SPECKS)],
  ] as const)('writes the SVG the app writes for %s', { timeout: 60_000 }, async (label, test) => {
    const app = await appSvg(test);
    const cli = await cliSvg(test);
    expect(app.text).toContain('<path');
    expect(sha256(cli.text)).toBe(sha256(app.text));
    // Both sides disclose the same retry, and the specks cases do need it.
    expect(cli.relaxed).toBe(app.relaxed);
    expect(app.relaxed).toBe(label.includes('relaxed retry'));
  });

  it('proves the specks fixture is empty on a plain first pass', async () => {
    const preset = TRACE_PRESETS['Line Art'];
    if (preset === undefined) throw new Error('No Line Art preset.');
    const first = await traceImageToColoredPaths(SPECKS, preset);
    expect(first).toHaveLength(0);
  });

  it('sizes a pHYs fixture from its embedded density, not the 254 dpi default', async () => {
    const { text: svg } = await cliSvg({
      ...png('Line Art', RING),
      bytes: encodePng(RING, DPI_300_PER_METRE),
    });
    // 96 px at 300 dpi is 8.128 mm; at the 254 dpi default it would be 9.6 mm.
    expect(svg).toMatch(/width="8\.128mm"/);
  });
});
