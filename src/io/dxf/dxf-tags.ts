// tokenizeDxf — ASCII DXF group-code/value pair reader (Phase H.6,
// ADR-098 clean-room mandate: no parser libraries). A DXF file is a flat
// list of two-line tags: an integer group code line followed by a value
// line; every higher construct (sections, tables, entities) is built from
// runs of these tags.

import { iterateLines } from '../../core/util';

export type DxfTag = {
  readonly code: number;
  readonly value: string;
};

export type TokenizeDxfResult =
  | { readonly kind: 'ok'; readonly tags: ReadonlyArray<DxfTag> }
  | { readonly kind: 'error'; readonly reason: string };

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF';
const GROUP_CODE_PATTERN = /^[+-]?\d+$/;

export function tokenizeDxf(text: string): TokenizeDxfResult {
  if (text.startsWith(BINARY_DXF_SENTINEL)) {
    return {
      kind: 'error',
      reason: 'Binary DXF is not supported — re-export as ASCII DXF.',
    };
  }
  // Lines are pulled in pairs rather than split up front, so a large DXF never
  // materializes one string per line (a 100 MB file is ~6 M of them).
  const lines = iterateLines(text);
  const tags: DxfTag[] = [];
  let lineNumber = 0;
  for (;;) {
    const codeEntry = lines.next();
    if (codeEntry.done === true) break;
    const codeLine = codeEntry.value.trim();
    lineNumber += 1;
    // Tolerate blank tail lines after the final tag (common in exports).
    if (codeLine === '' && restIsBlank(lines)) break;
    if (!GROUP_CODE_PATTERN.test(codeLine)) {
      return {
        kind: 'error',
        reason: `Malformed DXF: expected an integer group code on line ${lineNumber}, got "${truncate(codeLine)}".`,
      };
    }
    const valueEntry = lines.next();
    if (valueEntry.done === true) {
      return {
        kind: 'error',
        reason: `Malformed DXF: group code on line ${lineNumber} has no value line (truncated file).`,
      };
    }
    lineNumber += 1;
    const value = valueEntry.value.trim();
    const code = Number.parseInt(codeLine, 10);
    tags.push({ code, value });
    // (0, EOF) is the documented terminator; ignore anything after it.
    if (code === 0 && value === 'EOF') break;
  }
  return { kind: 'ok', tags };
}

// Consumes the remainder of the iterator; only ever called when the tokenizer is
// about to stop, so draining it is free.
function restIsBlank(lines: Generator<string, void, undefined>): boolean {
  for (const line of lines) {
    if (line.trim() !== '') return false;
  }
  return true;
}

function truncate(line: string): string {
  const MAX_ECHO = 24;
  return line.length > MAX_ECHO ? `${line.slice(0, MAX_ECHO)}…` : line;
}
