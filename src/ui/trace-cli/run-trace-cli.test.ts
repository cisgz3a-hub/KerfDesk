// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../__fixtures__/perceptual/png';
import { TRACE_PRESETS } from '../../core/trace';
import { VISIBLE_TRACE_PRESET_NAMES } from '../trace/dialog-parts';
import { mergeLightBurnTraceSettings } from '../trace/trace-options';
import { TRACE_OVERRIDE_RULES } from '../trace/trace-settings-snapshot';
import { runTraceCli, traceCliTraceOptions, TRACE_CLI_EXIT } from './run-trace-cli';
import {
  parseTraceCliArgs,
  TRACE_CLI_OVERRIDE_FLAGS,
  TRACE_CLI_PRESETS,
  TraceCliUsageError,
} from './trace-cli-options';
import { traceCliHelp } from './trace-cli-help';

function square(size = 48): Uint8Array {
  const rgb = new Uint8Array(size * size * 3).fill(255);
  for (let y = 12; y < size - 12; y += 1)
    rgb.fill(0, (y * size + 12) * 3, (y * size + size - 12) * 3);
  return encodeRgbPng(rgb, size, size);
}

async function run(argv: ReadonlyArray<string>, input: Uint8Array = square()) {
  const out = { code: -1, stdout: '', stderr: '', files: new Map<string, string>() };
  out.code = await runTraceCli(argv, {
    readInput: async () => input,
    writeOutput: async (path, text) => {
      if (path === null) out.stdout += text;
      else out.files.set(path, text);
    },
    writeError: (text) => {
      out.stderr += text;
    },
  });
  return out;
}

describe('trace command (ADR-477)', () => {
  it.each([
    ['svg', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*width="[\d.]+mm"/],
    ['dxf', /^ *0\r?\nSECTION\r?\n/],
    ['pdf', /^%PDF-1\.\d/],
    ['eps', /^%!PS-Adobe-3\.0 EPSF-3\.0/],
    ['geojson', /^\{"type":"FeatureCollection"/],
  ])('writes a %s file', { timeout: 30_000 }, async (format, signature) => {
    const result = await run(['--format', format, '-o', `out.${format}`, 'in.png']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(TRACE_CLI_EXIT.ok);
    expect(result.files.get(`out.${format}`)).toMatch(signature);
  });

  it('prints its help text', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(TRACE_CLI_EXIT.ok);
    expect(result.stdout).toBe(traceCliHelp());
    expect(result.stdout).toMatchSnapshot();
  });

  it('exits 2 on invalid options and 1 on an unreadable image', async () => {
    const usage = [
      ['--smoothness', '9'],
      ['--preset', 'Nope'],
      ['--frobnicate'],
      ['a.png', 'b.png'],
    ];
    for (const argv of usage) expect((await run(argv)).code).toBe(TRACE_CLI_EXIT.usage);
    const garbage = await run([], new TextEncoder().encode('not an image'));
    expect(garbage.code).toBe(TRACE_CLI_EXIT.failed);
    expect(garbage.stderr).toMatch(/Unrecognised image format/);
    expect((await run([], new Uint8Array())).code).toBe(TRACE_CLI_EXIT.failed);
  });

  it('exits 3 and writes nothing when the trace finds no ink', async () => {
    const blank = encodeRgbPng(new Uint8Array(32 * 32 * 3).fill(255), 32, 32);
    const result = await run([], blank);
    expect(result.code).toBe(TRACE_CLI_EXIT.empty);
    expect(result.stdout).toBe('');
  });

  it('offers the Trace dialog presets and one flag per dialog override', () => {
    expect([...TRACE_CLI_PRESETS]).toEqual([...VISIBLE_TRACE_PRESET_NAMES]);
    for (const name of TRACE_CLI_PRESETS) expect(TRACE_PRESETS[name]).toBeDefined();
    expect(Object.keys(TRACE_CLI_OVERRIDE_FLAGS).sort()).toEqual(
      Object.keys(TRACE_OVERRIDE_RULES).sort(),
    );
    const flags = Object.values(TRACE_CLI_OVERRIDE_FLAGS).map((entry) => entry.flag);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('merges preset and overrides as the Trace dialog does', () => {
    const parsed = parseTraceCliArgs([
      '-p',
      'line-art',
      '--smoothness=0.5',
      '--optimize',
      '0.4',
      '--ignore-less-than',
      '12',
      '--cutoff',
      '10',
      '--threshold',
      '200',
      '--diagonal-contacts',
      'connect-paper',
      '--no-fill-pinholes',
      '--invert',
    ]);
    expect(parsed.presetName).toBe('Line Art');
    expect(parsed.overrides).toEqual({
      smoothness: 0.5,
      optimize: 0.4,
      ignoreLessThanPixels: 12,
      cutoffLuma: 10,
      thresholdLuma: 200,
      turnPolicy: 'connect-paper',
      fillPinholeCracks: false,
      invert: true,
    });
    const preset = TRACE_PRESETS['Line Art'];
    if (preset === undefined) throw new Error('Line Art preset missing');
    const image = { width: 100, height: 50, data: new Uint8ClampedArray(20_000) };
    expect(traceCliTraceOptions(parsed, { image, widthMm: 10 })).toEqual(
      mergeLightBurnTraceSettings(preset, parsed.overrides),
    );
  });

  it('converts Line + fill max stroke width through the image density', () => {
    const parsed = parseTraceCliArgs(['-p', 'Line + fill', '--max-stroke-width', '0.5']);
    const image = { width: 200, height: 100, data: new Uint8ClampedArray(80_000) };
    expect(traceCliTraceOptions(parsed, { image, widthMm: 20 }).hybridMaxStrokeWidthPx).toBe(5);
  });

  it('reads densities, pages and stdin/stdout dashes', () => {
    expect(parseTraceCliArgs(['-r', '300x150', '-o', '-', '-']).dpi).toEqual({
      xDpi: 300,
      yDpi: 150,
    });
    const parsed = parseTraceCliArgs(['--page', 'artwork', '--margin', '2', 'x.png']);
    expect(parsed).toMatchObject({ pageFit: 'artwork', marginMm: 2, input: 'x.png', output: null });
    expect(() => parseTraceCliArgs(['--dpi', '5'])).toThrow(TraceCliUsageError);
    expect(() => parseTraceCliArgs(['--colours', '2.5'])).toThrow(TraceCliUsageError);
  });

  it('runs as a command with exit codes', { timeout: 120_000 }, () => {
    const script = join(process.cwd(), 'scripts', 'trace-cli.mjs');
    const bad = spawnSync(process.execPath, [script, '--format', 'png'], { encoding: 'utf8' });
    expect(bad.stderr).toContain('--format must be one of');
    expect(bad.status).toBe(TRACE_CLI_EXIT.usage);
    const traced = spawnSync(process.execPath, [script, '-p', 'Sharp'], { input: square() });
    expect(traced.status).toBe(TRACE_CLI_EXIT.ok);
    expect(traced.stdout.toString('utf8')).toMatch(/^<svg /);
  });
});
