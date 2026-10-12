// The device seal a commercial desktop build appends to project text it saves
// (ADR-592). It is the last top-level property, so the sealed body is exactly
// the text before it and survives schema migrations unchanged. Other builds
// and older versions ignore the property; deserialization drops it.

export const PROJECT_SEAL_PROPERTY = 'kerfdeskDeviceSeal';

const SEAL = /^[A-Za-z0-9_-]{43}$/;
const SEALED_TAIL = /,(\n {2})?"kerfdeskDeviceSeal": ?"([A-Za-z0-9_-]{43})"\n?\}\n$/;
// Longer than any sealed tail, so a large project's text is never scanned whole.
const TAIL_CHARACTERS = 96;

function sealedTail(
  text: string,
): { readonly index: number; readonly match: RegExpExecArray } | null {
  const start = Math.max(0, text.length - TAIL_CHARACTERS);
  const match = SEALED_TAIL.exec(text.slice(start));
  return match === null ? null : { index: start + match.index, match };
}

/** True when `text` already ends with a device seal. */
export function hasProjectSeal(text: string): boolean {
  return sealedTail(text) !== null;
}

/** `text` with `seal` appended, or unchanged when it is not a project object's text. */
export function withProjectSeal(text: string, seal: string): string {
  if (!SEAL.test(seal) || hasProjectSeal(text)) return text;
  if (text.endsWith('\n}\n'))
    return `${text.slice(0, -3)},\n  "${PROJECT_SEAL_PROPERTY}": "${seal}"\n}\n`;
  if (text.endsWith('}\n') && !text.endsWith('{}\n'))
    return `${text.slice(0, -2)},"${PROJECT_SEAL_PROPERTY}":"${seal}"}\n`;
  return text;
}

/** The text that was sealed, and its seal; `seal` is null for unsealed text. */
export function splitProjectSeal(text: string): {
  readonly body: string;
  readonly seal: string | null;
} {
  const tail = sealedTail(text);
  if (tail === null) return { body: text, seal: null };
  const pretty = tail.match[1] !== undefined;
  return {
    body: `${text.slice(0, tail.index)}${pretty ? '\n' : ''}}\n`,
    seal: tail.match[2] ?? null,
  };
}
