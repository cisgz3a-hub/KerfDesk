// --help text of the headless trace command (ADR-477), built from the same
// preset, format and override tables the parser reads, so the two cannot drift.

import { MAX_TRACED_PAGE_MARGIN_MM } from '../../core/trace/traced-page-box';
import { TRACE_OVERRIDE_RULES } from '../trace/trace-settings-snapshot';
import {
  TRACE_CLI_FORMATS,
  TRACE_CLI_OVERRIDE_FLAGS,
  TRACE_CLI_PRESETS,
} from './trace-cli-options';

const COLUMN = 30;

export function traceCliHelp(): string {
  const overrides = Object.entries(TRACE_CLI_OVERRIDE_FLAGS).map(([key, entry]) => {
    const rule = TRACE_OVERRIDE_RULES[key as keyof typeof TRACE_OVERRIDE_RULES];
    if (rule.kind === 'boolean') return row(`--[no-]${entry.flag}`, entry.help);
    const values = rule.kind === 'choice' ? ` (${rule.values.join(', ')})` : '';
    return row(`--${entry.flag} <value>`, entry.help + values);
  });
  return [
    'Usage: kerfdesk-trace [options] [input]',
    '',
    'Trace a raster image to vector artwork with the KerfDesk tracer, headless.',
    'Reads PNG, JPEG, BMP, TIFF (first page) or PBM/PGM/PPM from the input file,',
    'or from standard input when the input is "-" or omitted. Writes to the',
    'output file, or to standard output when it is "-" or omitted.',
    '',
    'Options:',
    row('-o, --output <file>', 'Output file (default: standard output)'),
    row('-p, --preset <name>', 'Trace preset (default: Line Art)'),
    row('-f, --format <format>', `Output format: ${TRACE_CLI_FORMATS.join(', ')} (default: svg)`),
    row('-r, --dpi <n>[x<n>]', 'Image density (default: embedded, else 254)'),
    row('--precision <mm>', 'Coordinate grid of the file (default: 0.001)'),
    row('--group-contours', 'Group each colour into one path'),
    row('--page <image|artwork>', 'Page: the whole image, or the artwork (default: image)'),
    row('--margin <mm>', `Space around the artwork page, 0-${MAX_TRACED_PAGE_MARGIN_MM} (default: 0)`),
    row('-h, --help', 'Show this help'),
    '',
    'Trace settings (the Trace dialog controls; unset ones keep the preset value):',
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

function row(flag: string, help: string): string {
  return `  ${flag.padEnd(COLUMN)}${help}`;
}
