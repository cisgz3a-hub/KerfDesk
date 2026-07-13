import { isObject } from './project-shape-primitives';

const MAX_VARIABLE_TOKENS = 1_000;
const MAX_CSV_ROWS = 100_000;
const MAX_CSV_COLUMNS = 1_000;

export function validateProjectVariables(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return 'missing or invalid `variables`';
  if (!isNonNegativeInteger(value['recordIndex'])) return invalid('variables.recordIndex');
  if (!isNonNegativeInteger(value['serialValue'])) return invalid('variables.serialValue');
  if (
    !['manual', 'after-successful-stream', 'after-successful-export'].includes(
      String(value['advancement']),
    )
  ) {
    return invalid('variables.advancement');
  }
  return validateCsvDataset(value['csv'], 'variables.csv');
}

export function validateVariableTemplate(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || !Array.isArray(value['tokens'])) return invalid(path);
  if (value['tokens'].length > MAX_VARIABLE_TOKENS) return `\`${path}\` has too many tokens`;
  for (let index = 0; index < value['tokens'].length; index += 1) {
    const tokenError = validateToken(value['tokens'][index], `${path}.tokens[${index}]`);
    if (tokenError !== null) return tokenError;
  }
  return null;
}

function validateToken(value: unknown, path: string): string | null {
  if (!isObject(value) || typeof value['kind'] !== 'string') return invalid(path);
  const validator = TOKEN_VALIDATORS[value['kind']];
  return validator === undefined ? invalid(`${path}.kind`) : validator(value, path);
}

type TokenValidator = (value: Record<string, unknown>, path: string) => string | null;
const TOKEN_VALIDATORS: Readonly<Record<string, TokenValidator>> = {
  literal: (value, path) => (typeof value['value'] === 'string' ? null : invalid(`${path}.value`)),
  'date-time': (value, path) =>
    ['date-iso', 'time-24h', 'datetime-iso'].includes(String(value['format']))
      ? null
      : invalid(`${path}.format`),
  serial: validateSerialToken,
  csv: (value, path) =>
    typeof value['column'] === 'string' && value['column'] !== ''
      ? null
      : invalid(`${path}.column`),
  'cut-setting': (value, path) =>
    ['power-percent', 'speed-mm-min', 'passes', 'air-assist'].includes(String(value['field']))
      ? null
      : invalid(`${path}.field`),
};

function validateSerialToken(value: Record<string, unknown>, path: string): string | null {
  if (typeof value['prefix'] !== 'string') return invalid(`${path}.prefix`);
  const width = value['width'];
  if (!Number.isInteger(width) || Number(width) < 1 || Number(width) > 20) {
    return invalid(`${path}.width`);
  }
  const offset = value['offset'];
  return offset === undefined || Number.isSafeInteger(offset) ? null : invalid(`${path}.offset`);
}

function validateCsvDataset(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || typeof value['sourceName'] !== 'string') return invalid(path);
  const headers = value['headers'];
  const records = value['records'];
  const headerError = validateHeaders(headers, path);
  if (headerError !== null) return headerError;
  return validateRecords(records, Array.isArray(headers) ? headers.length : 0, path);
}

function validateHeaders(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CSV_COLUMNS) {
    return invalid(`${path}.headers`);
  }
  if (!value.every((header) => typeof header === 'string' && header !== '')) {
    return invalid(`${path}.headers`);
  }
  return new Set(value).size === value.length ? null : `\`${path}.headers\` contains duplicates`;
}

function validateRecords(value: unknown, headerCount: number, path: string): string | null {
  const records = value;
  if (!Array.isArray(records) || records.length > MAX_CSV_ROWS) return invalid(`${path}.records`);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!Array.isArray(record) || record.length !== headerCount) {
      return invalid(`${path}.records[${index}]`);
    }
    if (!record.every((field) => typeof field === 'string')) {
      return invalid(`${path}.records[${index}]`);
    }
  }
  return null;
}

function isNonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalid(path: string): string {
  return `missing or invalid \`${path}\``;
}
