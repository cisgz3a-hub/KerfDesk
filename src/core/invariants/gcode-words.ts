const GCODE_NUMBER = String.raw`[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?`;
const WORD_BOUNDARY_AFTER_NUMBER = String.raw`(?=$|\s|[A-DF-Za-df-z])`;

export function parseGcodeWord(line: string, word: string): number | null {
  const match = new RegExp(
    String.raw`(?:^|[^A-Za-z])${escapeRegExp(word)}(${GCODE_NUMBER})${WORD_BOUNDARY_AFTER_NUMBER}`,
    'i',
  ).exec(line);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function isGcodeCommand(line: string, command: string): boolean {
  return new RegExp(String.raw`^${escapeRegExp(command)}(?=$|\s|[A-Za-z])`, 'i').test(line);
}

export function isGcodeMotionCommand(line: string): boolean {
  return /^G[0123](?=$|\s|[A-Za-z])/i.test(line);
}

export function stripGcodeComment(line: string): string {
  const semi = line.indexOf(';');
  const head = semi >= 0 ? line.slice(0, semi) : line;
  return head
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\(.*/, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
