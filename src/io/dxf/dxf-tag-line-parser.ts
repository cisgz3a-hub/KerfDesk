import type { DxfTag } from './dxf-tags';

export type DxfTagLineParserResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly reason: string };

export type DxfTagLineParser = {
  readonly pushLine: (line: string) => void;
  readonly finish: () => DxfTagLineParserResult;
};

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF';
const GROUP_CODE_PATTERN = /^[+-]?\d+$/;

export function createDxfTagLineParser(onTag: (tag: DxfTag) => void): DxfTagLineParser {
  let lineNumber = 0;
  let pendingCode: { code: number; line: number } | null = null;
  let blankTailLine: number | null = null;
  let terminalResult: DxfTagLineParserResult | null = null;
  let finished = false;

  const pushLine = (line: string): void => {
    lineNumber += 1;
    if (terminalResult !== null || finished) return;
    if (lineNumber === 1 && line.startsWith(BINARY_DXF_SENTINEL)) {
      terminalResult = {
        kind: 'error',
        reason: 'Binary DXF is not supported \u2014 re-export as ASCII DXF.',
      };
      return;
    }
    if (pendingCode !== null) {
      const value = line.trim();
      const code = pendingCode.code;
      pendingCode = null;
      onTag({ code, value });
      if (code === 0 && value === 'EOF') finished = true;
      return;
    }
    const codeLine = line.trim();
    if (codeLine === '') {
      blankTailLine ??= lineNumber;
      return;
    }
    if (blankTailLine !== null) {
      terminalResult = malformedCode(blankTailLine, '');
      return;
    }
    if (!GROUP_CODE_PATTERN.test(codeLine)) {
      terminalResult = malformedCode(lineNumber, codeLine);
      return;
    }
    pendingCode = { code: Number.parseInt(codeLine, 10), line: lineNumber };
  };

  const finish = (): DxfTagLineParserResult => {
    if (terminalResult !== null) return terminalResult;
    if (pendingCode !== null) {
      return {
        kind: 'error',
        reason: `Malformed DXF: group code on line ${pendingCode.line} has no value line (truncated file).`,
      };
    }
    return { kind: 'ok' };
  };

  return { pushLine, finish };
}

function malformedCode(lineNumber: number, codeLine: string): DxfTagLineParserResult {
  return {
    kind: 'error',
    reason: `Malformed DXF: expected an integer group code on line ${lineNumber}, got "${truncate(codeLine)}".`,
  };
}

function truncate(line: string): string {
  const maxEcho = 24;
  return line.length > maxEcho ? `${line.slice(0, maxEcho)}\u2026` : line;
}
