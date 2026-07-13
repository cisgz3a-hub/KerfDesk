import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Layer,
  type Project,
  type TextObject,
  type VariableTemplate,
  type VariableTemplateToken,
} from '../scene';

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
  const values: string[] = [];
  for (const token of template.tokens) {
    const evaluated = evaluateToken(token, text, project, context);
    if (!evaluated.ok) return evaluated;
    values.push(evaluated.value);
  }
  return { ok: true, value: values.join('') };
}

function evaluateToken(
  token: VariableTemplateToken,
  text: TextObject,
  project: Project,
  context: VariableEvaluationContext,
): VariableEvaluationResult {
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
  const columnIndex = dataset.headers.indexOf(column);
  if (columnIndex < 0) return { ok: false, message: `CSV column "${column}" was not found.` };
  const recordIndex = context.recordIndex ?? variables.recordIndex;
  const record = dataset.records[recordIndex];
  if (record === undefined)
    return { ok: false, message: `CSV record ${recordIndex + 1} is missing.` };
  return { ok: true, value: record[columnIndex] ?? '' };
}

function evaluateCutSetting(
  field: Extract<VariableTemplateToken, { readonly kind: 'cut-setting' }>['field'],
  text: TextObject,
  project: Project,
): VariableEvaluationResult {
  const layer = project.scene.layers.find((candidate) => candidate.color === text.color);
  if (layer === undefined) return { ok: false, message: `No cut layer matches ${text.color}.` };
  return { ok: true, value: cutSettingValue(field, layer) };
}

function cutSettingValue(
  field: Extract<VariableTemplateToken, { readonly kind: 'cut-setting' }>['field'],
  layer: Layer,
): string {
  switch (field) {
    case 'power-percent':
      return String(layer.power);
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
