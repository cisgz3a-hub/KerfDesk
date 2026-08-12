const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/gu;
const LINE_SEPARATOR_PATTERN = /[\r\n\u2028\u2029]/u;
const ORDINARY_DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u;
const C0_LAST_CODE_UNIT = 0x1f;
const DELETE_CODE_UNIT = 0x7f;
const C1_LAST_CODE_UNIT = 0x9f;
const BRACE_DELIMITER_LENGTH = 2;

export type UserMacroTemplateError =
  | { readonly kind: 'empty-template'; readonly message: string }
  | { readonly kind: 'multiline-template'; readonly message: string }
  | { readonly kind: 'control-character'; readonly message: string; readonly index: number }
  | { readonly kind: 'malformed-placeholder'; readonly message: string; readonly index: number };

export type UserMacroTemplateResult =
  | {
      readonly kind: 'ok';
      readonly template: string;
      readonly variables: ReadonlyArray<string>;
    }
  | UserMacroTemplateError;

export type UserMacroExpansionResult =
  | { readonly kind: 'ok'; readonly command: string }
  | {
      readonly kind: 'invalid-template';
      readonly error: UserMacroTemplateError;
      readonly message: string;
    }
  | { readonly kind: 'missing-variable'; readonly variable: string; readonly message: string }
  | { readonly kind: 'invalid-variable'; readonly variable: string; readonly message: string };

/** Finds distinct numeric placeholders in first-occurrence order. */
export function parseUserMacroTemplate(template: string): UserMacroTemplateResult {
  if (LINE_SEPARATOR_PATTERN.test(template)) {
    return {
      kind: 'multiline-template',
      message: 'A user macro must contain exactly one Console command on one line.',
    };
  }
  const controlIndex = controlCharacterIndex(template);
  if (controlIndex >= 0) {
    return {
      kind: 'control-character',
      index: controlIndex,
      message: 'A user macro template cannot contain control characters.',
    };
  }
  if (template.trim() === '') {
    return { kind: 'empty-template', message: 'Enter one Console command for this macro.' };
  }
  return parsePlaceholders(template);
}

/** Substitutes finite ordinary-decimal values without producing another line. */
export function expandUserMacroTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): UserMacroExpansionResult {
  const parsed = parseUserMacroTemplate(template);
  if (parsed.kind !== 'ok') {
    return { kind: 'invalid-template', error: parsed, message: parsed.message };
  }
  for (const variable of parsed.variables) {
    const value = ownVariableValue(values, variable);
    if (value === undefined) {
      return {
        kind: 'missing-variable',
        variable,
        message: `Enter a decimal value for {{${variable}}}.`,
      };
    }
    if (!isFiniteOrdinaryDecimal(value)) {
      return {
        kind: 'invalid-variable',
        variable,
        message: `{{${variable}}} must be one finite decimal number without spaces or exponent notation.`,
      };
    }
  }
  const command = parsed.template.replace(
    PLACEHOLDER_PATTERN,
    (placeholder, variable: string) => ownVariableValue(values, variable) ?? placeholder,
  );
  return { kind: 'ok', command };
}

function parsePlaceholders(template: string): UserMacroTemplateResult {
  let cursor = 0;
  let variables: ReadonlyArray<string> = [];
  while (cursor < template.length) {
    const braceIndex = nextBraceIndex(template, cursor);
    if (braceIndex < 0) break;
    if (!template.startsWith('{{', braceIndex)) return malformedPlaceholder(braceIndex);
    const closeIndex = template.indexOf('}}', braceIndex + BRACE_DELIMITER_LENGTH);
    if (closeIndex < 0) return malformedPlaceholder(braceIndex);
    const identifier = template.slice(braceIndex + BRACE_DELIMITER_LENGTH, closeIndex);
    if (!IDENTIFIER_PATTERN.test(identifier)) return malformedPlaceholder(braceIndex);
    if (!variables.includes(identifier)) variables = [...variables, identifier];
    cursor = closeIndex + BRACE_DELIMITER_LENGTH;
  }
  return { kind: 'ok', template, variables };
}

function nextBraceIndex(template: string, start: number): number {
  const openIndex = template.indexOf('{', start);
  const closeIndex = template.indexOf('}', start);
  if (openIndex < 0) return closeIndex;
  if (closeIndex < 0) return openIndex;
  return Math.min(openIndex, closeIndex);
}

function malformedPlaceholder(index: number): UserMacroTemplateError {
  return {
    kind: 'malformed-placeholder',
    index,
    message: 'Use complete placeholders in the form {{variable_name}}.',
  };
}

function isFiniteOrdinaryDecimal(value: string): boolean {
  return ORDINARY_DECIMAL_PATTERN.test(value) && Number.isFinite(Number(value));
}

function ownVariableValue(
  values: Readonly<Record<string, string>>,
  variable: string,
): string | undefined {
  return Object.prototype.hasOwnProperty.call(values, variable) ? values[variable] : undefined;
}

function controlCharacterIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= C0_LAST_CODE_UNIT ||
      (codeUnit >= DELETE_CODE_UNIT && codeUnit <= C1_LAST_CODE_UNIT)
    ) {
      return index;
    }
  }
  return -1;
}
