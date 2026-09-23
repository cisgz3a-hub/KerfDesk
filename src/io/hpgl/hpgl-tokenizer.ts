import {
  HPGL_IMPORT_LIMITS,
  HPGL_SUPPORTED_COMMANDS,
  HpglError,
  type HpglCommand,
} from './hpgl-types';

const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/y;
const LETTER = /[a-z]/i;
const SPACE = /[ \t\r\n]/;
const SUPPORTED: ReadonlySet<string> = new Set(HPGL_SUPPORTED_COMMANDS);

/** Full-token ASCII grammar; never recovers by skipping unrecognised source bytes. */
export function* hpglCommands(text: string): Generator<HpglCommand> {
  if (text.length > HPGL_IMPORT_LIMITS.textLength) {
    throw new HpglError(
      'limit-exceeded',
      `Input exceeds ${HPGL_IMPORT_LIMITS.textLength} characters.`,
    );
  }
  let index = 0;
  let commands = 0;
  let numbers = 0;
  while (index < text.length) {
    if (SPACE.test(text.charAt(index)) || text[index] === ';') {
      index += 1;
      continue;
    }
    const name = text.slice(index, index + 2).toUpperCase();
    const location = { name, offset: index };
    if (!/^[A-Z]{2}$/.test(name))
      throw new HpglError('invalid-syntax', 'Expected a two-letter command.', location);
    if (!SUPPORTED.has(name))
      throw new HpglError(
        'unsupported-command',
        `Unsupported command ${name}. No partial artwork was imported; convert unsupported content to outlines or export SVG/DXF.`,
        location,
      );
    if (++commands > HPGL_IMPORT_LIMITS.commands)
      throw new HpglError('limit-exceeded', 'Too many commands.', location);
    index += 2;
    if (name === 'CO') {
      index = skipComment(text, index, location);
      yield { ...location, values: [] };
      continue;
    }
    const parsed = readValues(text, index, location);
    index = parsed.index;
    numbers += parsed.values.length;
    if (numbers > HPGL_IMPORT_LIMITS.numbers)
      throw new HpglError('limit-exceeded', 'Too many numeric parameters.', location);
    yield { ...location, values: parsed.values };
  }
}

function readValues(text: string, start: number, command: Pick<HpglCommand, 'name' | 'offset'>) {
  const values: number[] = [];
  let index = start;
  let afterComma = false;
  while (index < text.length) {
    const spaced = SPACE.test(text.charAt(index));
    while (SPACE.test(text.charAt(index))) index += 1;
    const char = text.charAt(index);
    if (isTerminator(char)) break;
    if (char === ',') {
      if (values.length === 0 || afterComma)
        throw new HpglError('invalid-syntax', 'Missing numeric parameter.', command);
      afterComma = true;
      index += 1;
      continue;
    }
    checkSeparator(values.length, spaced || afterComma, char, command);
    const numeric = readNumber(text, index, command);
    values.push(numeric.value);
    if (values.length > HPGL_IMPORT_LIMITS.numbers)
      throw new HpglError('limit-exceeded', 'Too many numeric parameters.', command);
    afterComma = false;
    index = numeric.end;
  }
  if (afterComma)
    throw new HpglError('invalid-syntax', 'Trailing comma has no parameter.', command);
  return { index, values };
}

function isTerminator(char: string): boolean {
  return char === '' || char === ';' || LETTER.test(char);
}

function checkSeparator(
  count: number,
  separated: boolean,
  char: string,
  command: Pick<HpglCommand, 'name' | 'offset'>,
): void {
  if (count > 0 && !separated && char !== '+' && char !== '-')
    throw new HpglError('invalid-syntax', 'Numeric parameters need a separator.', command);
}

function readNumber(text: string, index: number, command: Pick<HpglCommand, 'name' | 'offset'>) {
  NUMBER.lastIndex = index;
  const match = NUMBER.exec(text);
  if (match === null) throw new HpglError('invalid-syntax', 'Invalid numeric parameter.', command);
  const value = Number(match[0]);
  if (!Number.isFinite(value))
    throw new HpglError('invalid-parameters', 'Numeric parameters must be finite.', command);
  return { value, end: NUMBER.lastIndex };
}

function skipComment(
  text: string,
  start: number,
  command: Pick<HpglCommand, 'name' | 'offset'>,
): number {
  let index = start;
  while (SPACE.test(text[index] ?? '')) index += 1;
  if (text[index] !== '"')
    throw new HpglError(
      'invalid-syntax',
      'CO comments must be enclosed in double quotes.',
      command,
    );
  const end = text.indexOf('"', index + 1);
  if (end === -1) throw new HpglError('invalid-syntax', 'Unterminated CO comment.', command);
  return end + 1;
}
