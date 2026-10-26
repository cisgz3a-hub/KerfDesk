const SECRET_SUFFIXES = [
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'api-key',
];

/** Consume each complete key token once. A regexp starting at every word
 * boundary can retry an unbounded hyphenated token quadratically. */
export function redactKeyedSecretValues(text: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let copyFrom = 0;
  while (cursor < text.length) {
    if (!isKeyCode(text.charCodeAt(cursor))) {
      cursor += 1;
      continue;
    }
    const keyStart = cursor;
    while (isKeyCode(text.charCodeAt(cursor))) cursor += 1;
    const key = text.slice(keyStart, cursor).toLowerCase();
    if (!SECRET_SUFFIXES.some((suffix) => key.endsWith(suffix))) continue;
    const start = valueStart(text, keyStart, cursor);
    if (start === null) continue;
    const range = valueRange(text, start);
    if (range === null) continue;
    parts.push(text.slice(copyFrom, range.content), '[removed]');
    copyFrom = range.end;
    cursor = range.next;
  }
  if (parts.length === 0) return text;
  parts.push(text.slice(copyFrom));
  return parts.join('');
}

function valueRange(
  text: string,
  start: number,
): {
  readonly content: number;
  readonly end: number;
  readonly next: number;
} | null {
  const delimiter = text.charAt(start);
  const quoted = delimiter === '"' || delimiter === "'";
  const content = start + (quoted ? 1 : 0);
  const end = quoted ? quotedValueEnd(text, content, delimiter) : unquotedValueEnd(text, content);
  if (!quoted && end === content) return null;
  return { content, end, next: end + (quoted && text.charAt(end) === delimiter ? 1 : 0) };
}

function valueStart(text: string, keyStart: number, keyEnd: number): number | null {
  const json = text.charAt(keyStart - 1) === '"' && text.charAt(keyEnd) === '"';
  const separator = skipWhitespace(text, keyEnd + (json ? 1 : 0));
  if (text.charAt(separator) !== (json ? ':' : '=')) return null;
  const start = skipWhitespace(text, separator + 1);
  // JSON secrets are strings; leave ordinary non-string fields unchanged.
  if (json && text.charAt(start) !== '"') return null;
  return start;
}

function skipWhitespace(text: string, start: number): number {
  let end = start;
  while (end < text.length && /\s/.test(text.charAt(end))) end += 1;
  return end;
}

/** An escaped quote belongs to the value. Truncated logs stop at their line
 * boundary so a missing quote cannot consume later report sections. */
function quotedValueEnd(text: string, start: number, quote: string): number {
  let end = start;
  let escaped = false;
  while (end < text.length) {
    const character = text.charAt(end);
    if (character === '\r' || character === '\n' || (!escaped && character === quote)) break;
    escaped = !escaped && character === '\\';
    end += 1;
  }
  return end;
}

function unquotedValueEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !/[\s&;,"']/.test(text.charAt(end))) end += 1;
  return end;
}

function isKeyCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 45
  );
}
