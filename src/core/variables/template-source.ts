import type { VariableTemplate, VariableTemplateToken } from '../scene';

export type VariableTemplateSourceResult =
  | { readonly ok: true; readonly template: VariableTemplate }
  | { readonly ok: false; readonly message: string };

const TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;

export function parseVariableTemplateSource(source: string): VariableTemplateSourceResult {
  const tokens: VariableTemplateToken[] = [];
  let cursor = 0;
  let variableFields = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const index = match.index;
    if (index > cursor) tokens.push({ kind: 'literal', value: source.slice(cursor, index) });
    const parsed = parseTag(match[1] ?? '');
    if (!parsed.ok) return parsed;
    tokens.push(parsed.token);
    variableFields += 1;
    cursor = index + match[0].length;
  }
  if (cursor < source.length) tokens.push({ kind: 'literal', value: source.slice(cursor) });
  if (variableFields === 0) return { ok: false, message: 'Add at least one variable field.' };
  return { ok: true, template: { tokens } };
}

export function variableTemplateToSource(template: VariableTemplate): string {
  return template.tokens.map(tokenToSource).join('');
}

function parseTag(
  tag: string,
):
  | { readonly ok: true; readonly token: VariableTemplateToken }
  | { readonly ok: false; readonly message: string } {
  const simple = SIMPLE_TAGS[tag];
  if (simple !== undefined) return { ok: true, token: simple };
  if (tag.startsWith('csv:')) {
    const column = tag.slice(4).trim();
    return column === ''
      ? { ok: false, message: 'Choose a CSV column for the variable field.' }
      : { ok: true, token: { kind: 'csv', column } };
  }
  if (tag.startsWith('serial:')) {
    const width = Number(tag.slice(7));
    return Number.isInteger(width) && width >= 1 && width <= 20
      ? { ok: true, token: { kind: 'serial', prefix: '', width } }
      : { ok: false, message: 'Serial width must be an integer from 1 to 20.' };
  }
  return { ok: false, message: `Unknown variable field "${tag}".` };
}

const SIMPLE_TAGS: Readonly<Record<string, VariableTemplateToken>> = {
  date: { kind: 'date-time', format: 'date-iso' },
  time: { kind: 'date-time', format: 'time-24h' },
  datetime: { kind: 'date-time', format: 'datetime-iso' },
  power: { kind: 'cut-setting', field: 'power-percent' },
  speed: { kind: 'cut-setting', field: 'speed-mm-min' },
  passes: { kind: 'cut-setting', field: 'passes' },
  air: { kind: 'cut-setting', field: 'air-assist' },
};

function tokenToSource(token: VariableTemplateToken): string {
  if (token.kind === 'literal') return token.value;
  if (token.kind === 'date-time') {
    const tag =
      token.format === 'date-iso' ? 'date' : token.format === 'time-24h' ? 'time' : 'datetime';
    return `{{${tag}}}`;
  }
  if (token.kind === 'serial') return `{{serial:${token.width}}}`;
  if (token.kind === 'csv') return `{{csv:${token.column}}}`;
  const tags = {
    'power-percent': 'power',
    'speed-mm-min': 'speed',
    passes: 'passes',
    'air-assist': 'air',
  } as const;
  return `{{${tags[token.field]}}}`;
}
