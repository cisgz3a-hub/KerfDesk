// @vitest-environment node
// Edges of the headless trace command (ADR-477): switch parsing, --help ranges
// read from the rules, the density prefix shared with Multi-File Trace, and
// pixel-unit settings on images above the preview cap.

import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../__fixtures__/perceptual/png';
import { TRACE_PRESETS, type TraceOptions } from '../../core/trace';
import { IMAGE_DENSITY_PROBE_BYTES, readImageHeaderDensity } from '../common/image-density';
import { DETECTION_MODES, TRACE_OVERRIDE_RULES } from '../trace/trace-settings-snapshot';
import { nativeGridOptions, runTraceCli, traceCliTraceOptions } from './run-trace-cli';
import { traceCliHelp } from './trace-cli-help';
import {
  parseTraceCliArgs,
  TRACE_CLI_OVERRIDE_FLAGS,
  TraceCliUsageError,
} from './trace-cli-options';

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** A 48 px black square PNG with a 300 dpi pHYs after `padding` bytes of tEXt. */
function squareWithPhys(padding: number): Uint8Array {
  const rgb = new Uint8Array(48 * 48 * 3).fill(255);
  for (let y = 12; y < 36; y += 1) rgb.fill(0, (y * 48 + 12) * 3, (y * 48 + 36) * 3);
  const plain = encodeRgbPng(rgb, 48, 48);
  const afterIhdr = 8 + 25;
  const phys = new Uint8Array(9);
  new DataView(phys.buffer).setUint32(0, 11811);
  new DataView(phys.buffer).setUint32(4, 11811);
  phys[8] = 1;
  const text = new Uint8Array(padding).fill(0x61);
  text[7] = 0; // "aaaaaaa" keyword, then its text
  const parts = [
    plain.subarray(0, afterIhdr),
    ...(padding > 0 ? [chunk('tEXt', text)] : []),
    chunk('pHYs', phys),
    plain.subarray(afterIhdr),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

async function svgWidth(bytes: Uint8Array): Promise<string> {
  let out = '';
  const code = await runTraceCli(['-p', 'Sharp'], {
    readInput: async () => bytes,
    writeOutput: async (_path, text) => {
      out += text;
    },
    writeError: (text) => {
      throw new Error(text);
    },
  });
  expect(code).toBe(0);
  return /width="([\d.]+)mm"/.exec(out)?.[1] ?? '';
}

describe('trace command edges (ADR-477)', () => {
  it('refuses a separated or inline value on switches instead of misreading it', () => {
    expect(() => parseTraceCliArgs(['--invert', 'false'])).toThrow(/--invert=false or --no-invert/);
    expect(() => parseTraceCliArgs(['--group-contours=false'])).toThrow(TraceCliUsageError);
    expect(() => parseTraceCliArgs(['--help=yes'])).toThrow(TraceCliUsageError);
    expect(parseTraceCliArgs(['--invert=false']).overrides.invert).toBe(false);
    expect(parseTraceCliArgs(['--no-invert']).overrides.invert).toBe(false);
    const parsed = parseTraceCliArgs(['--invert', 'art.png']);
    expect(parsed).toMatchObject({ input: 'art.png', overrides: { invert: true } });
    // flagBool reads 1 and 0 too, so a detached 1/0 is refused like true/false.
    expect(() => parseTraceCliArgs(['--invert', '0'])).toThrow(/--invert=0 or --no-invert/);
    expect(() => parseTraceCliArgs(['--invert', '1', 'x.png'])).toThrow(/--invert=1/);
    // A negated switch takes no value: --no-invert=true must not read as off.
    expect(() => parseTraceCliArgs(['--no-invert=true'])).toThrow(/--no-invert takes no value/);
    expect(() => parseTraceCliArgs(['--no-invert=banana'])).toThrow(TraceCliUsageError);
  });

  it('refuses a --dpi with more than two parts', () => {
    expect(() => parseTraceCliArgs(['--dpi', '300x600x7'])).toThrow(/--dpi takes <n> or <n>x<n>/);
    expect(parseTraceCliArgs(['--dpi', '300x600']).dpi).toEqual({ xDpi: 300, yDpi: 600 });
    expect(parseTraceCliArgs(['--dpi', '300']).dpi).toEqual({ xDpi: 300, yDpi: 300 });
  });

  it('prints every range and choice from the rules the parser checks', () => {
    const help = traceCliHelp();
    for (const [key, entry] of Object.entries(TRACE_CLI_OVERRIDE_FLAGS)) {
      const rule = TRACE_OVERRIDE_RULES[key as keyof typeof TRACE_OVERRIDE_RULES];
      const line = help.split('\n').find((row) => row.includes(`-${entry.flag} `)) ?? '';
      if (rule.kind === 'number' || rule.kind === 'count-or-auto') {
        expect(line).toContain(`(${rule.min} to ${rule.max}`);
      }
      if (rule.kind === 'choice') expect(line).toContain(rule.values.join(', '));
      if (rule.kind === 'detection') expect(line).toContain(DETECTION_MODES.join(', '));
    }
  });

  it('reads density from the header prefix Multi-File Trace reads', async () => {
    const near = squareWithPhys(0);
    const far = squareWithPhys(IMAGE_DENSITY_PROBE_BYTES);
    // 48 px at 300 dpi is 4.064 mm; past the prefix both paths fall back to 254 dpi.
    expect(await svgWidth(near)).toBe('4.064');
    expect(await svgWidth(far)).toBe('4.8');
    expect(await readImageHeaderDensity(new Blob([new Uint8Array(far)]))).toBeNull();
  });

  it('scales pixel-unit settings from the preview grid above the 2048 px cap', () => {
    const lineArt = TRACE_PRESETS['Line Art'] as TraceOptions;
    const options: TraceOptions = { ...lineArt, ignoreLessThanPixels: 10, edgeMinLengthPx: 3 };
    expect(nativeGridOptions(options, { width: 2048, height: 1024 })).toBe(options);
    // 4096 x 1024 previews at 2048 x 512: lengths x2, areas x4.
    expect(nativeGridOptions(options, { width: 4096, height: 1024 })).toMatchObject({
      ignoreLessThanPixels: 40,
      edgeMinLengthPx: 6,
    });
  });

  it('converts --max-stroke-width once, at the stored grid, on a large image', () => {
    const image = { width: 4096, height: 1024, data: new Uint8ClampedArray(0) };
    const parsed = parseTraceCliArgs(['-p', 'Line + fill', '--max-stroke-width', '0.5']);
    expect(TRACE_PRESETS['Line + fill']).toBeDefined();
    // 4096 px over 409.6 mm is 10 px/mm: 0.5 mm is 5 px, not scaled again.
    expect(traceCliTraceOptions(parsed, { image, widthMm: 409.6 }).hybridMaxStrokeWidthPx).toBe(5);
  });
});
