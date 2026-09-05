import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  primaryOperationForObject,
  type Layer,
  type Project,
  type TextObject,
  type VariableTemplate,
  type VariableTemplateToken,
} from '../scene';
import { effectiveObjectPowerPercent, effectiveOperationForObject } from '../effective-output';

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
  text: TextObject,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
  if (!Number.isFinite(context.now.getTime())) {
    return { ok: false, message: 'Variable evaluation needs a valid clock value.' };
  }
  if (typeof template !== 'object' || template === null || !Array.isArray(template.tokens)) {
    return { ok: false, message: 'Variable text template must contain a token list.' };
  }
  const values: string[] = [];
  for (const token of template.tokens) {
    const evaluated = evaluateToken(token, text, project, context);
    if (!evaluated.ok) return evaluated;
    values.push(evaluated.value);
  }
  return { ok: true, value: values.join('').normalize('NFC') };
}

function evaluateToken(
  token: VariableTemplateToken,
  text: TextObject,
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
      return { ok: true, value: formatDateTime(context.now, token.format) };
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
      return (
        typeof token['format'] === 'string' &&
        ['date-iso', 'time-24h', 'datetime-iso'].includes(token['format'])
      );
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
  text: TextObject,
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
  text: TextObject,
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

function formatDateTime(
  value: Date,
  format: Extract<VariableTemplateToken, { readonly kind: 'date-time' }>['format'],
): string {
  const iso = value.toISOString();
  if (format === 'date-iso') return iso.slice(0, 10);
  if (format === 'time-24h') return iso.slice(11, 19);
  return iso;
}
