// tokenizeDxf — ASCII DXF group-code/value pair reader (Phase H.6,
// ADR-094 clean-room mandate: no parser libraries). A DXF file is a flat
// list of two-line tags: an integer group code line followed by a value
// line; every higher construct (sections, tables, entities) is built from
// runs of these tags.

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
  const lines = text.split(/\r\n|\n|\r/);
  const tags: DxfTag[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const codeLine = (lines[i] ?? '').trim();
    // Tolerate blank tail lines after the final tag (common in exports).
    if (codeLine === '' && restIsBlank(lines, i)) break;
    if (!GROUP_CODE_PATTERN.test(codeLine)) {
      return {
        kind: 'error',
        reason: `Malformed DXF: expected an integer group code on line ${i + 1}, got "${truncate(codeLine)}".`,
      };
    }
    const value = lines[i + 1];
    if (value === undefined) {
      return {
        kind: 'error',
        reason: `Malformed DXF: group code on line ${i + 1} has no value line (truncated file).`,
      };
    }
    const code = Number.parseInt(codeLine, 10);
    tags.push({ code, value: value.trim() });
    // (0, EOF) is the documented terminator; ignore anything after it.
    if (code === 0 && value.trim() === 'EOF') break;
  }
  return { kind: 'ok', tags };
}

function restIsBlank(lines: ReadonlyArray<string>, from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() !== '') return false;
  }
  return true;
}

function truncate(line: string): string {
  const MAX_ECHO = 24;
  return line.length > MAX_ECHO ? `${line.slice(0, MAX_ECHO)}…` : line;
}
