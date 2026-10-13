import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  primaryOperationForObject,
  type Layer,
  type Project,
  type SceneObject,
  type VariableTemplate,
  type VariableTemplateToken,
} from '../scene';
import { formatDatePattern } from './date-pattern';
import { effectiveObjectPowerPercent, effectiveOperationForObject } from '../effective-output';
import { advanceVariableSequenceBy } from './sequence-offset';

export type VariableEvaluationContext = {
  readonly now: Date;
  readonly recordIndex?: number;
  readonly serialValue?: number;
};

export type VariableEvaluationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string };

export function evaluateVariableTemplate(
  template: VariableTemplate,
  text: SceneObject,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
  if (!Number.isFinite(context.now.getTime())) {
    return { ok: false, message: 'Variable evaluation needs a valid clock value.' };
  }
  if (typeof template !== 'object' || template === null || !Array.isArray(template.tokens)) {
    return { ok: false, message: 'Variable text template must contain a token list.' };
  }
  const copy = copyEvaluationContext(template, project, context);
  if (!copy.ok) return copy;
  const pieces: EvaluatedPiece[] = [];
  for (const token of template.tokens) {
    const evaluated = evaluateToken(token, text, project, copy.context);
    if (!evaluated.ok) return evaluated;
    pieces.push({
      value: evaluated.value,
      field: isTemplateToken(token) && token.kind !== 'literal',
    });
  }
  const value =
    template.ignoreEmptyLines === true
      ? withoutEmptyFieldLines(pieces)
      : pieces.map((piece) => piece.value).join('');
  return { ok: true, value: value.normalize('NFC') };
}

type EvaluatedPiece = { readonly value: string; readonly field: boolean };

// A line is dropped, with its line break, when it holds at least one field and
// only whitespace after evaluation. Lines typed empty on purpose are kept.
function withoutEmptyFieldLines(pieces: ReadonlyArray<EvaluatedPiece>): string {
  const lines: { text: string; field: boolean }[] = [{ text: '', field: false }];
  for (const piece of pieces) {
    const parts = piece.value.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ text: '', field: false });
      const line = lines[lines.length - 1] as { text: string; field: boolean };
      line.text += part;
      if (piece.field) line.field = true;
    });
  }
  return lines
    .filter((line) => !(line.field && line.text.trim() === ''))
    .map((line) => line.text)
    .join('\n');
}

function copyEvaluationContext(
  template: VariableTemplate,
  project: Project,
  context: VariableEvaluationContext,
):
  | { readonly ok: true; readonly context: VariableEvaluationContext }
  | { readonly ok: false; readonly message: string } {
  const offset = template.sequenceOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Number.MAX_SAFE_INTEGER)
    return { ok: false, message: 'Variable copy offset must be a non-negative safe integer.' };
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const serialValue = context.serialValue ?? variables.serialValue;
  if (offset > 0 && (!Number.isSafeInteger(serialValue) || serialValue < 0)) {
    return { ok: false, message: 'Variable serial must be a non-negative safe integer.' };
  }
  const assigned = advanceVariableSequenceBy(
    {
      ...variables,
      recordIndex: context.recordIndex ?? variables.recordIndex,
      serialValue,
    },
    offset,
  );
  return {
    ok: true,
    context: {
      ...context,
      recordIndex: assigned.recordIndex,
      serialValue: assigned.serialValue,
    },
  };
}

function evaluateToken(
  token: VariableTemplateToken,
  text: SceneObject,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
  if (!isTemplateToken(token)) {
    return { ok: false, message: 'Variable text contains a malformed token.' };
  }
  switch (token.kind) {
    case 'literal':
      return { ok: true, value: token.value };
    case 'date-time':
      return {
        ok: true,
        value:
          token.format === 'custom'
            ? formatDatePattern(context.now, token.pattern ?? '')
            : formatDateTime(context.now, token.format),
      };
    case 'serial':
      return evaluateSerial(token, project, context);
    case 'csv':
      return evaluateCsv(token.column, project, context);
    case 'cut-setting':
      return evaluateCutSetting(token.field, text, project);
  }
}

// Templates can survive in a running session after a parser error in an older
// build. Report malformed data through the ordinary evaluation result instead
// of throwing or silently dropping text while preparing output.
function isTemplateToken(value: unknown): value is VariableTemplateToken {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  switch (token['kind']) {
    case 'literal':
      return typeof token['value'] === 'string';
    case 'date-time':
      return isDateTimeToken(token);
    case 'serial':
      return isSerialToken(token);
    case 'csv':
      return typeof token['column'] === 'string' && token['column'] !== '';
    case 'cut-setting':
      return (
        typeof token['field'] === 'string' &&
        ['power-percent', 'speed-mm-min', 'passes', 'air-assist'].includes(token['field'])
      );
    default:
      return false;
  }
}

function isDateTimeToken(token: Record<string, unknown>): boolean {
  const format = token['format'];
  if (format === 'custom') return typeof token['pattern'] === 'string';
  return typeof format === 'string' && ['date-iso', 'time-24h', 'datetime-iso'].includes(format);
}

function isSerialToken(token: Record<string, unknown>): boolean {
  return (
    typeof token['prefix'] === 'string' &&
    Number.isInteger(token['width']) &&
    Number(token['width']) >= 1 &&
    Number(token['width']) <= 20 &&
    (token['offset'] === undefined || Number.isSafeInteger(token['offset']))
  );
}

function evaluateSerial(
  token: Extract<VariableTemplateToken, { readonly kind: 'serial' }>,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const value = (context.serialValue ?? variables.serialValue) + (token.offset ?? 0);
  if (!Number.isInteger(token.width) || token.width < 1 || token.width > 20) {
    return { ok: false, message: 'Serial width must be an integer from 1 to 20.' };
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    return { ok: false, message: 'Serial value must be a non-negative safe integer.' };
  }
  return { ok: true, value: `${token.prefix}${String(value).padStart(token.width, '0')}` };
}

function evaluateCsv(
  column: string,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const dataset = variables.csv;
  if (dataset === undefined) return { ok: false, message: 'This template needs an embedded CSV.' };
  const exactIndex = dataset.headers.indexOf(column);
  const columnIndex =
    exactIndex >= 0 ? exactIndex : uniqueCanonicalHeaderIndex(dataset.headers, column);
  if (columnIndex === 'ambiguous') {
    return {
      ok: false,
      message: `CSV column "${column}" is ambiguous because multiple canonically equivalent headers exist.`,
    };
  }
  if (columnIndex < 0) return { ok: false, message: `CSV column "${column}" was not found.` };
  const recordIndex = context.recordIndex ?? variables.recordIndex;
  const record = dataset.records[recordIndex];
  if (record === undefined)
    return { ok: false, message: `CSV record ${recordIndex + 1} is missing.` };
  return { ok: true, value: record[columnIndex] ?? '' };
}

function uniqueCanonicalHeaderIndex(
  headers: readonly string[],
  column: string,
): number | 'ambiguous' {
  const canonicalColumn = column.normalize('NFC');
  let match = -1;
  for (let index = 0; index < headers.length; index += 1) {
    if (headers[index]?.normalize('NFC') !== canonicalColumn) continue;
    if (match >= 0) return 'ambiguous';
    match = index;
  }
  return match;
}

function evaluateCutSetting(
  field: Extract<VariableTemplateToken, { readonly kind: 'cut-setting' }>['field'],
  text: SceneObject,
  project: Project,
): VariableEvaluationResult {
  const layer = primaryOperationForObject(text, project.scene.layers);
  if (layer === null) return { ok: false, message: 'No operation is assigned to this text.' };
  return {
    ok: true,
    value: cutSettingValue(field, effectiveOperationForObject(layer, text), text),
  };
}

function cutSettingValue(
  field: Extract<VariableTemplateToken, { readonly kind: 'cut-setting' }>['field'],
  layer: Layer,
  text: SceneObject,
): string {
  switch (field) {
    case 'power-percent':
      return String(effectiveObjectPowerPercent(layer, text));
    case 'speed-mm-min':
      return String(layer.speed);
    case 'passes':
      return String(layer.passes);
    case 'air-assist':
      return layer.airAssist ? 'on' : 'off';
  }
}

// Operators read an engraved date or time as the computer's wall clock, as in
// LightBurn, so every field comes from the Date's local-time view. The full
// form adds that zone's UTC offset so the text still names one instant.
function formatDateTime(
  value: Date,
  format: Extract<VariableTemplateToken, { readonly kind: 'date-time' }>['format'],
): string {
  const date = [
    String(value.getFullYear()).padStart(4, '0'),
    twoDigits(value.getMonth() + 1),
    twoDigits(value.getDate()),
  ].join('-');
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()].map(twoDigits).join(':');
  if (format === 'date-iso') return date;
  if (format === 'time-24h') return time;
  return `${date}T${time}${utcOffset(value.getTimezoneOffset())}`;
}

// getTimezoneOffset() counts minutes from local time back to UTC, so a zone
// behind UTC reports a positive value and prints a negative offset.
function utcOffset(minutesToUtc: number): string {
  const minutes = Math.abs(minutesToUtc);
  const sign = minutesToUtc > 0 ? '-' : '+';
  return `${sign}${twoDigits(Math.floor(minutes / 60))}:${twoDigits(minutes % 60)}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
