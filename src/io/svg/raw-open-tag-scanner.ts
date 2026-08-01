type ScannerMode =
  | 'text'
  | 'prefix'
  | 'open'
  | 'close'
  | 'pi'
  | 'bang'
  | 'comment'
  | 'cdata'
  | 'declaration';

export class RawOpenTagScanner {
  private mode: ScannerMode = 'text';
  private rawOpenTag = '';
  private quote: '"' | "'" | null = null;
  private tail = '';
  private declarationDepth = 0;
  private declarationComment = false;
  private declarationPi = false;
  private readonly completeOpenTags: string[] = [];
  private nextOpenTagIndex = 0;

  write(text: string): void {
    for (const character of text) this.consume(character);
  }

  take(): string {
    const raw = this.completeOpenTags[this.nextOpenTagIndex];
    if (raw === undefined) throw new Error('SVG source tag did not match the validated XML event');
    this.nextOpenTagIndex += 1;
    if (this.nextOpenTagIndex === this.completeOpenTags.length) {
      this.completeOpenTags.length = 0;
      this.nextOpenTagIndex = 0;
    }
    return raw;
  }

  private consume(character: string): void {
    if (this.mode === 'text') {
      if (character === '<') {
        this.mode = 'prefix';
        this.rawOpenTag = '<';
      }
      return;
    }
    if (this.mode === 'prefix' || this.mode === 'bang') {
      this.consumePrefix(character);
      return;
    }
    if (this.mode === 'open') {
      this.consumeOpenTag(character);
      return;
    }
    this.consumeDelimitedMarkup(character);
  }

  private consumeDelimitedMarkup(character: string): void {
    if (this.mode === 'close') {
      if (character === '>') this.resetMarkup();
      return;
    }
    if (this.mode === 'pi') {
      this.tail = `${this.tail}${character}`.slice(-2);
      if (this.tail === '?>') this.resetMarkup();
      return;
    }
    if (this.mode === 'comment') {
      this.tail = `${this.tail}${character}`.slice(-3);
      if (this.tail === '-->') this.resetMarkup();
      return;
    }
    if (this.mode === 'cdata') {
      this.tail = `${this.tail}${character}`.slice(-3);
      if (this.tail === ']]>') this.resetMarkup();
      return;
    }
    this.consumeDeclaration(character);
  }

  private consumePrefix(character: string): void {
    this.rawOpenTag += character;
    if (this.rawOpenTag.length === 2) {
      if (character === '/') this.mode = 'close';
      else if (character === '?') {
        this.mode = 'pi';
        this.tail = '<?';
      } else if (character === '!') this.mode = 'bang';
      else this.mode = 'open';
      return;
    }
    if (this.rawOpenTag === '<!--') {
      this.mode = 'comment';
      this.tail = '!--';
      this.rawOpenTag = '';
      return;
    }
    if (this.rawOpenTag === '<![CDATA[') {
      this.mode = 'cdata';
      this.tail = 'TA[';
      this.rawOpenTag = '';
      return;
    }
    if ('<!--'.startsWith(this.rawOpenTag) || '<![CDATA['.startsWith(this.rawOpenTag)) return;

    const declarationPrefix = this.rawOpenTag.slice(2);
    this.mode = 'declaration';
    this.rawOpenTag = '';
    this.resetDeclaration();
    for (const value of declarationPrefix) this.consumeDeclaration(value);
  }

  private consumeOpenTag(character: string): void {
    this.rawOpenTag += character;
    if (this.quote !== null) {
      if (character === this.quote) this.quote = null;
      return;
    }
    if (character === '"' || character === "'") {
      this.quote = character;
      return;
    }
    if (character !== '>') return;
    this.completeOpenTags.push(this.rawOpenTag);
    this.resetMarkup();
  }

  private consumeDeclaration(character: string): void {
    this.tail = `${this.tail}${character}`.slice(-4);
    if (this.declarationComment) {
      this.consumeDeclarationComment();
      return;
    }
    if (this.declarationPi) {
      this.consumeDeclarationPi();
      return;
    }
    if (this.quote !== null) {
      if (character === this.quote) this.quote = null;
      return;
    }
    this.consumeDeclarationMarkup(character);
  }

  private consumeDeclarationComment(): void {
    if (this.tail.endsWith('-->')) {
      this.declarationComment = false;
      this.tail = '';
    }
  }

  private consumeDeclarationPi(): void {
    if (this.tail.endsWith('?>')) {
      this.declarationPi = false;
      this.tail = '';
    }
  }

  private consumeDeclarationMarkup(character: string): void {
    if (this.tail.endsWith('<!--')) {
      this.declarationComment = true;
      return;
    }
    if (this.tail.endsWith('<?')) {
      this.declarationPi = true;
      return;
    }
    if (character === '"' || character === "'") {
      this.quote = character;
    } else if (character === '[') {
      this.declarationDepth += 1;
    } else if (character === ']') {
      this.declarationDepth = Math.max(0, this.declarationDepth - 1);
    } else if (character === '>' && this.declarationDepth === 0) {
      this.resetMarkup();
    }
  }

  private resetMarkup(): void {
    this.mode = 'text';
    this.rawOpenTag = '';
    this.quote = null;
    this.tail = '';
    this.resetDeclaration();
  }

  private resetDeclaration(): void {
    this.declarationDepth = 0;
    this.declarationComment = false;
    this.declarationPi = false;
  }
}
