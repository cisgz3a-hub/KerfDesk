export enum JsonTokenType {
  LEFT_BRACE,
  RIGHT_BRACE,
  LEFT_BRACKET,
  RIGHT_BRACKET,
  COLON,
  COMMA,
  STRING,
  NUMBER,
  TRUE,
  FALSE,
  NULL,
}

export type JsonToken = {
  readonly token: JsonTokenType;
  readonly value?: unknown;
};

type TokenizerState = 'default' | 'string' | 'escape' | 'unicode' | 'number' | 'literal';

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const STRING_BUFFER_SIZE = 4 * 1024;

/** Incremental tokenizer for one standards-compliant JSON text. */
export class JsonTokenizer {
  public onToken: (token: JsonToken) => void = () => {
    throw new Error('JSON tokenizer has no token consumer');
  };

  private state: TokenizerState = 'default';
  private ended = false;
  private readonly stringParts: string[] = [];
  private stringBuffer = '';
  private unicodeDigits = '';
  private numberText = '';
  private literalTarget = '';
  private literalIndex = 0;

  public write(input: string): void {
    if (this.ended) throw new Error('JSON tokenizer is already ended');
    let index = 0;
    while (index < input.length) {
      const character = input[index];
      if (character === undefined) break;
      if (this.consumeCharacter(character)) index += 1;
    }
  }

  public end(): void {
    if (this.ended) throw new Error('JSON tokenizer is already ended');
    if (this.state === 'number') this.finishNumber();
    if (this.state !== 'default') throw new Error(`JSON input ended during ${this.state}`);
    this.ended = true;
  }

  private consumeCharacter(character: string): boolean {
    if (this.state === 'string') return this.consumeString(character);
    if (this.state === 'escape') return this.consumeEscape(character);
    if (this.state === 'unicode') return this.consumeUnicode(character);
    if (this.state === 'number') return this.consumeNumber(character);
    if (this.state === 'literal') return this.consumeLiteral(character);
    return this.consumeDefault(character);
  }

  private consumeString(character: string): true {
    if (character === '"') {
      this.emit(JsonTokenType.STRING, this.finishString());
      this.state = 'default';
    } else if (character === '\\') {
      this.state = 'escape';
    } else {
      if (character.charCodeAt(0) <= 0x1f) {
        throw new Error('Unescaped control character in JSON string');
      }
      this.appendString(character);
    }
    return true;
  }

  private consumeEscape(character: string): true {
    if (character === 'u') {
      this.unicodeDigits = '';
      this.state = 'unicode';
    } else {
      const escaped = simpleEscape(character);
      if (escaped === null) throw new Error(`Invalid JSON escape \\${character}`);
      this.appendString(escaped);
      this.state = 'string';
    }
    return true;
  }

  private consumeUnicode(character: string): true {
    if (!isHexDigit(character)) throw new Error('Invalid hexadecimal digit in JSON escape');
    this.unicodeDigits += character;
    if (this.unicodeDigits.length === 4) {
      this.appendString(String.fromCharCode(Number.parseInt(this.unicodeDigits, 16)));
      this.state = 'string';
    }
    return true;
  }

  private consumeNumber(character: string): boolean {
    if (isNumberCharacter(character)) {
      this.numberText += character;
      return true;
    }
    this.finishNumber();
    return false;
  }

  private consumeLiteral(character: string): true {
    if (character !== this.literalTarget[this.literalIndex]) {
      throw new Error(`Invalid JSON literal '${this.literalTarget}'`);
    }
    this.literalIndex += 1;
    if (this.literalIndex === this.literalTarget.length) this.finishLiteral();
    return true;
  }

  private consumeDefault(character: string): true {
    if (isJsonWhitespace(character)) return true;
    const punctuation = punctuationToken(character);
    if (punctuation !== null) this.emit(punctuation);
    else if (character === '"') {
      this.resetString();
      this.state = 'string';
    } else if (character === '-' || isDigit(character)) {
      this.numberText = character;
      this.state = 'number';
    } else if (character === 't') this.startLiteral('true');
    else if (character === 'f') this.startLiteral('false');
    else if (character === 'n') this.startLiteral('null');
    else throw new Error(`Unexpected character ${JSON.stringify(character)} in JSON input`);
    return true;
  }

  private startLiteral(target: 'true' | 'false' | 'null'): void {
    this.literalTarget = target;
    this.literalIndex = 1;
    this.state = 'literal';
  }

  private finishLiteral(): void {
    if (this.literalTarget === 'true') this.emit(JsonTokenType.TRUE, true);
    else if (this.literalTarget === 'false') this.emit(JsonTokenType.FALSE, false);
    else this.emit(JsonTokenType.NULL, null);
    this.literalTarget = '';
    this.literalIndex = 0;
    this.state = 'default';
  }

  private finishNumber(): void {
    if (!NUMBER_PATTERN.test(this.numberText)) {
      throw new Error(`Invalid JSON number '${this.numberText}'`);
    }
    this.emit(JsonTokenType.NUMBER, Number(this.numberText));
    this.numberText = '';
    this.state = 'default';
  }

  private resetString(): void {
    this.stringParts.splice(0);
    this.stringBuffer = '';
  }

  private appendString(value: string): void {
    this.stringBuffer += value;
    if (this.stringBuffer.length < STRING_BUFFER_SIZE) return;
    this.stringParts.push(this.stringBuffer);
    this.stringBuffer = '';
  }

  private finishString(): string {
    if (this.stringBuffer.length > 0) this.stringParts.push(this.stringBuffer);
    const value = this.stringParts.join('');
    this.resetString();
    return value;
  }

  private emit(token: JsonTokenType, value?: unknown): void {
    this.onToken(value === undefined ? { token } : { token, value });
  }
}

function simpleEscape(character: string): string | null {
  if (character === '"' || character === '\\' || character === '/') return character;
  if (character === 'b') return '\b';
  if (character === 'f') return '\f';
  if (character === 'n') return '\n';
  if (character === 'r') return '\r';
  if (character === 't') return '\t';
  return null;
}

function punctuationToken(character: string): JsonTokenType | null {
  if (character === '{') return JsonTokenType.LEFT_BRACE;
  if (character === '}') return JsonTokenType.RIGHT_BRACE;
  if (character === '[') return JsonTokenType.LEFT_BRACKET;
  if (character === ']') return JsonTokenType.RIGHT_BRACKET;
  if (character === ':') return JsonTokenType.COLON;
  if (character === ',') return JsonTokenType.COMMA;
  return null;
}

function isJsonWhitespace(character: string): boolean {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t';
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function isNumberCharacter(character: string): boolean {
  return isDigit(character) || ['-', '+', '.', 'e', 'E'].includes(character);
}

function isHexDigit(character: string): boolean {
  return (
    isDigit(character) ||
    (character >= 'a' && character <= 'f') ||
    (character >= 'A' && character <= 'F')
  );
}
