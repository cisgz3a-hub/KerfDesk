const ENGLISH_DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u;

export const ENGLISH_DECIMAL_ERROR =
  'Enter a number using English digits and a decimal point (for example 12.5). Commas are not accepted.';

export function parseEnglishDecimalInput(input: string): number | null {
  const trimmed = input.trim();
  if (!ENGLISH_DECIMAL_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function validateEnglishDecimalInput(input: string): string | null {
  return parseEnglishDecimalInput(input) === null ? ENGLISH_DECIMAL_ERROR : null;
}
