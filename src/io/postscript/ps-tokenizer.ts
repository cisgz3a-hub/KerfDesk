// PostScript scanner (PLRM 3rd ed. §3.2). Produces values: numbers, strings,
// names and procedures. `//name` is resolved while scanning, as the language
// requires. Binary tokens and binary object sequences are not supported.

import { PsError, psName, psString, type PsArray, type PsValue } from './ps-types';

const WHITESPACE = new Set(['\0', '\t', '\n', '\f', '\r', ' ']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const INTEGER = /^[+-]?\d+$/;
const REAL = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
const RADIX = /^(\d{1,2})#([0-9a-zA-Z]+)$/;
const MAX_PROCEDURE_NESTING = 128;
const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '\\': '\\',
  '(': '(',
  ')': ')',
};

const CLOSE_BRACE = Symbol('close-brace');

export class PsTokenizer {
  pos = 0;

  constructor(
    private readonly text: string,
    private readonly resolveImmediate: (name: string) => PsValue,
  ) {}

  /** The next value, or undefined at the end of the text. */
  next(): PsValue | undefined {
    const token = this.scan(0);
    if (token === CLOSE_BRACE) throw new PsError('syntaxerror', 'Unmatched } in the file.');
    return token;
  }

  /**
   * Skip an eexec-encrypted section (an embedded Type 1 font): its cipher text
   * ends with zeros before `cleartomark` (PLRM §6.3, Type 1 spec §7.2).
   */
  skipEncryptedSection(): void {
    const end = this.text.indexOf('cleartomark', this.pos);
    if (end < 0) throw new PsError('syntaxerror', 'An encrypted font section never ends.');
    this.pos = end;
  }

  private scan(depth: number): PsValue | undefined | typeof CLOSE_BRACE {
    this.skipSpace();
    if (this.pos >= this.text.length) return undefined;
    const ch = this.text.charAt(this.pos);
    switch (ch) {
      case '(':
        return this.readString();
      case '<':
        return this.readAngle();
      case '>':
        return this.readDictEnd();
      case '[':
      case ']':
        this.pos += 1;
        return psName(ch, false);
      case '{':
        return this.readProcedure(depth);
      case '}':
        this.pos += 1;
        return CLOSE_BRACE;
      case '/':
        return this.readLiteralName();
      case ')':
        throw new PsError('syntaxerror', 'Unmatched ) in the file.');
      default:
        return this.readRegular();
    }
  }

  private skipSpace(): void {
    while (this.pos < this.text.length) {
      const ch = this.text.charAt(this.pos);
      if (WHITESPACE.has(ch)) this.pos += 1;
      else if (ch === '%') {
        const end = this.text.slice(this.pos).search(/[\r\n]/);
        this.pos = end < 0 ? this.text.length : this.pos + end;
      } else return;
    }
  }

  private readRegular(): PsValue {
    const start = this.pos;
    while (this.pos < this.text.length) {
      const ch = this.text.charAt(this.pos);
      if (WHITESPACE.has(ch) || DELIMITERS.has(ch)) break;
      this.pos += 1;
    }
    const word = this.text.slice(start, this.pos);
    if (word === '') throw new PsError('syntaxerror', 'Unexpected character in the file.');
    return numberToken(word) ?? psName(word, false);
  }

  private readLiteralName(): PsValue {
    this.pos += 1;
    const immediate = this.text.charAt(this.pos) === '/';
    if (immediate) this.pos += 1;
    const start = this.pos;
    while (this.pos < this.text.length) {
      const ch = this.text.charAt(this.pos);
      if (WHITESPACE.has(ch) || DELIMITERS.has(ch)) break;
      this.pos += 1;
    }
    const name = this.text.slice(start, this.pos);
    return immediate ? this.resolveImmediate(name) : psName(name, true);
  }

  private readProcedure(depth: number): PsArray {
    if (depth >= MAX_PROCEDURE_NESTING)
      throw new PsError('limitcheck', 'Procedures are nested too deeply.');
    this.pos += 1;
    const items: PsValue[] = [];
    for (;;) {
      const token = this.scan(depth + 1);
      if (token === undefined) throw new PsError('syntaxerror', 'A procedure { is never closed.');
      if (token === CLOSE_BRACE) return { kind: 'array', items, exec: true };
      items.push(token);
    }
  }

  private readString(): PsValue {
    let depth = 1;
    let out = '';
    this.pos += 1;
    while (this.pos < this.text.length) {
      const ch = this.text.charAt(this.pos++);
      if (ch === '\\') out += this.readEscape();
      else if (ch === '(') {
        depth += 1;
        out += ch;
      } else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return psString(out);
        out += ch;
      } else out += ch;
    }
    throw new PsError('syntaxerror', 'A string ( is never closed.');
  }

  private readEscape(): string {
    const ch = this.text.charAt(this.pos);
    if (/[0-7]/.test(ch)) {
      const octal = /^[0-7]{1,3}/.exec(this.text.slice(this.pos, this.pos + 3))?.[0] ?? '0';
      this.pos += octal.length;
      return String.fromCharCode(parseInt(octal, 8) & 0xff);
    }
    this.pos += 1;
    if (ch === '\r' && this.text.charAt(this.pos) === '\n') this.pos += 1;
    if (ch === '\r' || ch === '\n') return '';
    return ESCAPES[ch] ?? ch;
  }

  private readAngle(): PsValue {
    const next = this.text.charAt(this.pos + 1);
    if (next === '<') {
      this.pos += 2;
      return psName('<<', false);
    }
    const ascii85 = next === '~';
    const close = ascii85 ? '~>' : '>';
    const end = this.text.indexOf(close, this.pos);
    if (end < 0) throw new PsError('syntaxerror', 'A < string is never closed.');
    const body = this.text.slice(this.pos + (ascii85 ? 2 : 1), end);
    this.pos = end + close.length;
    // ASCII85 strings are kept raw: the reader never decodes binary payloads.
    return psString(ascii85 ? body : hexString(body));
  }

  private readDictEnd(): PsValue {
    if (this.text.charAt(this.pos + 1) !== '>')
      throw new PsError('syntaxerror', 'Unexpected > in the file.');
    this.pos += 2;
    return psName('>>', false);
  }
}

function numberToken(word: string): number | null {
  if (INTEGER.test(word) || REAL.test(word)) {
    const value = Number(word);
    return Number.isFinite(value) ? value : null;
  }
  const radix = RADIX.exec(word);
  if (radix === null) return null;
  const base = Number(radix[1]);
  if (base < 2 || base > 36) return null;
  const digits = radix[2] ?? '';
  // parseInt stops at the first digit too large for the base ("8#19" -> 1);
  // PLRM 3.2.2 makes such a token not a number at all (O8-P3-3).
  if (Array.from(digits).some((digit) => parseInt(digit, 36) >= base)) return null;
  const value = parseInt(digits, base);
  return Number.isFinite(value) ? value : null;
}

function hexString(body: string): string {
  const digits = body.replace(/\s+/g, '');
  if (/[^0-9a-fA-F]/.test(digits)) throw new PsError('syntaxerror', 'Invalid hex string.');
  const padded = digits.length % 2 === 0 ? digits : digits + '0';
  let out = '';
  for (let i = 0; i < padded.length; i += 2)
    out += String.fromCharCode(parseInt(padded.slice(i, i + 2), 16));
  return out;
}
