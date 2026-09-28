// Command-line options of the headless trace command (ADR-477). The trace
// controls are the Trace dialog's own overrides: every key of
// TRACE_OVERRIDE_RULES has one flag here (a type error otherwise), its value
// is checked against the range the dialog's control offers, and the preset
// plus overrides merge through mergeLightBurnTraceSettings exactly as the
// dialog merges them. Output defaults are the Multi-File Trace dialog's.

import type { BatchTraceFormat } from '../../core/trace/batch-trace';
import { MAX_TRACED_PAGE_MARGIN_MM, type TracedPageFit } from '../../core/trace/traced-page-box';
import { DEFAULT_EXPORT_PRECISION_MM } from '../../core/vector-export/decimal-grid';
import type { ImageDensity } from '../common/image-density';
import type { LightBurnTraceSettingOverrides } from '../trace/trace-options';
import { DETECTION_MODES, TRACE_OVERRIDE_RULES } from '../trace/trace-settings-snapshot';

type OverrideKey = keyof typeof TRACE_OVERRIDE_RULES;

export type TraceCliOptions = {
  readonly help: boolean;
  readonly input: string | null;
  readonly output: string | null;
  readonly presetName: string;
  readonly format: BatchTraceFormat;
  readonly dpi: ImageDensity | null;
  readonly precisionMm: number;
  readonly groupContours: boolean;
  readonly pageFit: TracedPageFit;
  readonly marginMm: number;
  readonly overrides: LightBurnTraceSettingOverrides;
};

export class TraceCliUsageError extends Error {}

/** The Trace dialog's presets, in its order (dialog-parts VISIBLE_TRACE_PRESET_NAMES). */
export const TRACE_CLI_PRESETS = [
  'Line Art',
  'Photo shading',
  'Smooth',
  'Sharp',
  'Centerline',
  'Line + fill',
  'Edge Detection',
  'Colour layers',
] as const;

export const TRACE_CLI_FORMATS: ReadonlyArray<BatchTraceFormat> = [
  'svg',
  'dxf',
  'pdf',
  'eps',
  'geojson',
];

/** Flag name and help line of each Trace dialog override. */
export const TRACE_CLI_OVERRIDE_FLAGS: Readonly<
  Record<OverrideKey, { readonly flag: string; readonly help: string }>
> = {
  cutoffLuma: { flag: 'cutoff', help: 'Cutoff: darkest luma counted as ink' },
  thresholdLuma: { flag: 'threshold', help: 'Threshold: lightest luma counted as ink' },
  ignoreLessThanPixels: { flag: 'ignore-less-than', help: 'Ignore shapes under N pixels' },
  smoothness: { flag: 'smoothness', help: 'Smoothness' },
  optimize: { flag: 'optimize', help: 'Optimize: curve fit tolerance' },
  turnPolicy: { flag: 'diagonal-contacts', help: 'Diagonal contacts' },
  invert: { flag: 'invert', help: 'Trace light artwork on a dark ground' },
  detectionMode: { flag: 'detection', help: 'Ink detection' },
  despeckleMinPixels: { flag: 'despeckle', help: 'Remove specks under N pixels' },
  fillPinholeCracks: { flag: 'fill-pinholes', help: 'Close pinholes and hairline cracks' },
  traceTransparency: { flag: 'trace-transparency', help: 'Trace the alpha mask' },
  sketchTrace: { flag: 'sketch', help: 'Sketch (pencil) detection' },
  edgeSensitivity: { flag: 'edge-sensitivity', help: 'Edge Detection sensitivity' },
  edgeDetail: { flag: 'edge-detail', help: 'Edge Detection detail' },
  edgeMinimumLinePx: { flag: 'edge-min-line', help: 'Edge Detection shortest line in px' },
  hybridMaxStrokeWidthMm: { flag: 'max-stroke-width', help: 'Line + fill max stroke in mm' },
  photoDetail: { flag: 'photo-detail', help: 'Photo shading detail' },
  photoBrightness: { flag: 'photo-brightness', help: 'Photo shading brightness' },
  photoContrast: { flag: 'photo-contrast', help: 'Photo shading contrast' },
  photoGamma: { flag: 'photo-gamma', help: 'Photo shading gamma' },
  photoInvert: { flag: 'photo-invert', help: 'Photo shading invert' },
  colourCount: { flag: 'colours', help: 'Colour layers count' },
  colourLayerOutput: { flag: 'colour-output', help: 'Colour layers output style' },
  keepBackground: { flag: 'keep-background', help: 'Colour layers: keep the background' },
};

/** Accepted --precision (mm) and --dpi values; --help prints these. */
export const TRACE_CLI_PRECISION_RANGE = { min: 1e-6, max: 1 } as const;
export const TRACE_CLI_DPI_RANGE = { min: 10, max: 10_000 } as const;

const DEFAULTS: TraceCliOptions = {
  help: false,
  input: null,
  output: null,
  presetName: 'Line Art',
  format: 'svg',
  dpi: null,
  precisionMm: DEFAULT_EXPORT_PRECISION_MM,
  groupContours: false,
  pageFit: 'image',
  marginMm: 0,
  overrides: {},
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Draft = Mutable<Omit<TraceCliOptions, 'overrides'>> & {
  overrides: Record<string, unknown>;
};

const FLAG_TO_KEY = new Map<string, OverrideKey>(
  Object.entries(TRACE_CLI_OVERRIDE_FLAGS).map(([key, entry]) => [entry.flag, key as OverrideKey]),
);

export function parseTraceCliArgs(argv: ReadonlyArray<string>): TraceCliOptions {
  const draft: Draft = { ...DEFAULTS, overrides: {} };
  const positional: string[] = [];
  const queue = [...argv];
  while (queue.length > 0) {
    const arg = queue.shift() ?? '';
    if (arg === '-' || !arg.startsWith('-')) positional.push(arg);
    else if (arg === '--') positional.push(...queue.splice(0));
    else applyFlag(draft, arg, queue);
  }
  if (positional.length > 1) throw new TraceCliUsageError('Give at most one input file.');
  const input = positional[0];
  return { ...draft, input: input === undefined || input === '-' ? null : input };
}

function applyFlag(draft: Draft, arg: string, queue: string[]): void {
  const eq = arg.indexOf('=');
  const name = arg.slice(arg.startsWith('--') ? 2 : 1, eq < 0 ? undefined : eq);
  const inline = eq < 0 ? undefined : arg.slice(eq + 1);
  const value = (): string => {
    const next = inline ?? queue.shift();
    if (next === undefined) throw new TraceCliUsageError(`--${name} needs a value.`);
    return next;
  };
  if (applyGeneralFlag(draft, name, inline, value)) return;
  if (applyOverrideFlag(draft, name, inline, value)) {
    refuseDetachedBoolean(name, inline, queue);
    return;
  }
  throw new TraceCliUsageError(`Unknown option ${arg}. Run with --help for the list.`);
}

type GeneralFlag = (draft: Draft, value: () => string) => void;

const GENERAL_FLAGS: Readonly<Record<string, GeneralFlag>> = {
  help: (draft) => {
    draft.help = true;
  },
  output: (draft, value) => {
    draft.output = outputPath(value());
  },
  preset: (draft, value) => {
    draft.presetName = presetName(value());
  },
  format: (draft, value) => {
    draft.format = formatName(value());
  },
  dpi: (draft, value) => {
    draft.dpi = dpiValue(value());
  },
  precision: (draft, value) => {
    const { min, max } = TRACE_CLI_PRECISION_RANGE;
    draft.precisionMm = numberIn('precision', value(), min, max);
  },
  'group-contours': (draft) => {
    draft.groupContours = true;
  },
  page: (draft, value) => {
    draft.pageFit = pageFit(value());
  },
  margin: (draft, value) => {
    draft.marginMm = numberIn('margin', value(), 0, MAX_TRACED_PAGE_MARGIN_MM);
  },
};

const SHORT_FLAGS: Readonly<Record<string, string>> = {
  h: 'help',
  o: 'output',
  p: 'preset',
  f: 'format',
  r: 'dpi',
};

/** General flags that take no value: `--group-contours=false` is refused, not read as on. */
const VALUELESS_FLAGS: ReadonlySet<string> = new Set(['help', 'group-contours']);

function applyGeneralFlag(
  draft: Draft,
  name: string,
  inline: string | undefined,
  value: () => string,
): boolean {
  const long = SHORT_FLAGS[name] ?? name;
  const apply = Object.hasOwn(GENERAL_FLAGS, long) ? GENERAL_FLAGS[long] : undefined;
  if (apply === undefined) return false;
  if (inline !== undefined && VALUELESS_FLAGS.has(long)) {
    throw new TraceCliUsageError(`--${long} takes no value; leave it out for the default.`);
  }
  apply(draft, value);
  return true;
}

function applyOverrideFlag(
  draft: Draft,
  name: string,
  inline: string | undefined,
  value: () => string,
): boolean {
  const negated = name.startsWith('no-') ? FLAG_TO_KEY.get(name.slice(3)) : undefined;
  if (negated !== undefined && TRACE_OVERRIDE_RULES[negated].kind === 'boolean') {
    if (inline !== undefined) {
      throw new TraceCliUsageError(`--${name} takes no value; write --${name.slice(3)}=false.`);
    }
    draft.overrides[negated] = false;
    return true;
  }
  const key = FLAG_TO_KEY.get(name);
  if (key === undefined) return false;
  const rule = TRACE_OVERRIDE_RULES[key];
  if (rule.kind === 'boolean')
    draft.overrides[key] = inline === undefined || flagBool(name, inline);
  else if (rule.kind === 'number')
    draft.overrides[key] = numberIn(name, value(), rule.min, rule.max);
  else if (rule.kind === 'count-or-auto') draft.overrides[key] = countOrAuto(name, value(), rule);
  else draft.overrides[key] = choice(name, value(), overrideChoices(rule));
  return true;
}

/** Choices of a choice rule; the detection rule's are DETECTION_MODES. */
export function overrideChoices(rule: {
  readonly kind: string;
  readonly values?: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  return rule.values ?? DETECTION_MODES;
}

// `--invert false` would otherwise set invert on and read "false" as the
// input file: a boolean override takes its value only as `--flag=false`.
function refuseDetachedBoolean(name: string, inline: string | undefined, queue: string[]): void {
  const key = FLAG_TO_KEY.get(name);
  if (key === undefined || inline !== undefined) return;
  if (TRACE_OVERRIDE_RULES[key].kind !== 'boolean') return;
  const next = queue[0];
  if (next !== undefined && BOOLEAN_WORDS.has(next)) {
    throw new TraceCliUsageError(
      `--${name} takes no separate value; write --${name}=${next} or --no-${name}.`,
    );
  }
}

const BOOLEAN_WORDS: ReadonlySet<string> = new Set(['true', 'false', '1', '0']);

function flagBool(name: string, text: string): boolean {
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw new TraceCliUsageError(`--${name} takes true or false, not "${text}".`);
}

function numberIn(name: string, text: string, min: number, max: number): number {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value) || value < min || value > max) {
    throw new TraceCliUsageError(`--${name} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function countOrAuto(
  name: string,
  text: string,
  rule: { readonly min: number; readonly max: number },
): number | 'auto' {
  if (text === 'auto') return 'auto';
  const value = numberIn(name, text, rule.min, rule.max);
  if (!Number.isInteger(value)) throw new TraceCliUsageError(`--${name} must be a whole number.`);
  return value;
}

function choice(name: string, text: string, values: ReadonlyArray<string>): string {
  if (!values.includes(text)) {
    throw new TraceCliUsageError(`--${name} must be one of: ${values.join(', ')}.`);
  }
  return text;
}

function outputPath(text: string): string | null {
  return text === '-' ? null : text;
}

/** A preset by its dialog name, any case, with dashes or underscores for spaces. */
export function presetName(text: string): string {
  const wanted = normalisePreset(text);
  const found = TRACE_CLI_PRESETS.find((name) => normalisePreset(name) === wanted);
  if (found === undefined) {
    throw new TraceCliUsageError(
      `Unknown preset "${text}". Presets: ${TRACE_CLI_PRESETS.join(', ')}.`,
    );
  }
  return found;
}

function normalisePreset(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/\s*\+\s*/g, ' + ')
    .trim();
}

function formatName(text: string): BatchTraceFormat {
  const lower = text.toLowerCase() as BatchTraceFormat;
  if (!TRACE_CLI_FORMATS.includes(lower)) {
    throw new TraceCliUsageError(`--format must be one of: ${TRACE_CLI_FORMATS.join(', ')}.`);
  }
  return lower;
}

function pageFit(text: string): TracedPageFit {
  if (text === 'image' || text === 'artwork') return text;
  throw new TraceCliUsageError('--page must be image or artwork.');
}

function dpiValue(text: string): ImageDensity {
  const parts = text.toLowerCase().split('x');
  if (parts.length > 2) throw new TraceCliUsageError('--dpi takes <n> or <n>x<n>.');
  const [x = '', y = x] = parts;
  const { min, max } = TRACE_CLI_DPI_RANGE;
  return { xDpi: numberIn('dpi', x, min, max), yDpi: numberIn('dpi', y, min, max) };
}
