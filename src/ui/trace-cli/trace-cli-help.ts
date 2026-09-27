// --help text of the headless trace command (ADR-477), built from the same
// preset, format and override tables the parser reads, so the two cannot drift.

import { MAX_TRACED_PAGE_MARGIN_MM } from '../../core/trace/traced-page-box';
import { TRACE_OVERRIDE_RULES } from '../trace/trace-settings-snapshot';
import {
  TRACE_CLI_FORMATS,
  TRACE_CLI_OVERRIDE_FLAGS,
  TRACE_CLI_DPI_RANGE,
  TRACE_CLI_PRECISION_RANGE,
  TRACE_CLI_PRESETS,
  overrideChoices,
} from './trace-cli-options';

const COLUMN = 30;

export function traceCliHelp(): string {
  const overrides = Object.entries(TRACE_CLI_OVERRIDE_FLAGS).map(([key, entry]) => {
    const rule = TRACE_OVERRIDE_RULES[key as keyof typeof TRACE_OVERRIDE_RULES];
    if (rule.kind === 'boolean') return row(`--[no-]${entry.flag}`, entry.help);
    return row(`--${entry.flag} <value>`, `${entry.help} (${ruleValues(rule)})`);
  });
  return [
    'Usage: kerfdesk-trace [options] [input]',
    '',
    'Trace a raster image to vector artwork with the KerfDesk tracer, headless.',
    'Reads PNG, JPEG, BMP, TIFF (first page) or PBM/PGM/PPM from the input file,',
    'or from standard input when the input is "-" or omitted. Writes to the',
    'output file, or to standard output when it is "-" or omitted. GIF is not read;',
    'save the frame to trace as PNG. Retry and other trace warnings go to stderr.',
    '',
    "Output matches the app's Multi-File Trace for 8-bit sRGB PNG and BMP images",
    'up to 2048 px on the long edge. The app has no Netpbm import: PBM/PGM/PPM',
    'trace the pixels they hold, as an app import of the same pixels would. JPEG',
    'decodes with a different IDCT and chroma upsampling than the browser, and',
    'colour profiles (ICC, gAMA) are not applied, so edge pixels of such images',
    'can trace slightly differently.',
    '',
    'Options:',
    row('-o, --output <file>', 'Output file (default: standard output)'),
    row('-p, --preset <name>', 'Trace preset (default: Line Art)'),
    row('-f, --format <format>', `Output format: ${TRACE_CLI_FORMATS.join(', ')} (default: svg)`),
    row(
      '-r, --dpi <n>[x<n>]',
      `Image density, ${range(TRACE_CLI_DPI_RANGE)} (default: embedded, else 254)`,
    ),
    row(
      '--precision <mm>',
      `Coordinate grid of the file, ${range(TRACE_CLI_PRECISION_RANGE)} (default: 0.001)`,
    ),
    row('--group-contours', 'Group each colour into one path'),
    row('--page <image|artwork>', 'Page: the whole image, or the artwork (default: image)'),
    row(
      '--margin <mm>',
      `Space around the artwork page, 0 to ${MAX_TRACED_PAGE_MARGIN_MM} (default: 0)`,
    ),
    row('-h, --help', 'Show this help'),
    '',
    'Trace settings (the Trace dialog controls; unset ones keep the preset value).',
    'Values outside the range are refused. Switches take --flag, --no-flag or',
    '--flag=true|false. Pixel counts and lengths are pixels of the image, as the',
    'dialog sees them for images up to 2048 px on the long edge; larger images',
    "trace at full resolution with those settings scaled as the app's finer",
    'commit grid scales them.',
    ...overrides,
    '',
    `Presets: ${TRACE_CLI_PRESETS.join(', ')}.`,
    'Preset names ignore case; dashes or underscores may stand for spaces.',
    '',
    'Exit status: 0 traced, 1 the image could not be read or traced,',
    '2 invalid options, 3 the trace found nothing to draw.',
    '',
  ].join('\n');
}

type Rule = (typeof TRACE_OVERRIDE_RULES)[keyof typeof TRACE_OVERRIDE_RULES];

// The accepted values, read from the rule the parser checks against.
function ruleValues(rule: Rule): string {
  switch (rule.kind) {
    case 'number':
      return range(rule);
    case 'count-or-auto':
      return `${range(rule)}, or auto`;
    case 'boolean':
      return 'true or false';
    case 'choice':
    case 'detection':
      return overrideChoices(rule).join(', ');
  }
}

function range(bounds: { readonly min: number; readonly max: number }): string {
  return `${bounds.min} to ${bounds.max}`;
}

function row(flag: string, help: string): string {
  return `  ${flag.padEnd(COLUMN)}${help}`;
}
