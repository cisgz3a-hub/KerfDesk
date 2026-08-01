type ScannerMode =
  | 'text'
  | 'prefix'
  | 'open'
  | 'close'
  | 'pi'
  | 'bang'
  | 'comment'
  | 'cdata'
  | 'doctype'
  | 'dtd'
  | 'dtd-waka'
  | 'dtd-bang'
  | 'dtd-comment'
  | 'dtd-comment-ending'
  | 'dtd-comment-ended'
  | 'dtd-pi'
  | 'dtd-pi-ending';

const CDATA_OPEN = '[CDATA[';
const COMMENT_OPEN = '--';
const DOCTYPE_OPEN = 'DOCTYPE';
// '[CDATA[' and 'DOCTYPE' are the longest '<!' prefixes saxes accepts; past that
// length saxes reports "incorrect syntax" and the document never reaches an event.
const MAX_BANG_OPEN_LENGTH = 7;
const PI_CLOSE = '?>';
const COMMENT_CLOSE = '-->';
const CDATA_CLOSE = ']]>';

/**
 * Re-reads the literal source text of every open tag saxes reports, so attribute
 * values whose raw spelling matters (literal whitespace, character references)
 * can be recovered. Mirrors the saxes state machine character for character;
 * where the two could still disagree, `take()` yields null rather than refusing.
 */
export class RawOpenTagScanner {
  private mode: ScannerMode = 'text';
  private rawOpenTag = '';
  private bangOpen = '';
  private quote: '"' | "'" | null = null;
  private tail = '';
  private readonly completeOpenTags: string[] = [];
  private nextOpenTagIndex = 0;

  write(text: string): void {
    for (const character of text) this.consume(character);
  }

  /**
   * The next open tag exactly as it appeared in the source, or null when the
   * scanner has none left to hand out. Rule 7: a scanner that has drifted from
   * the saxes event stream must never refuse an import that saxes accepted — the
   * caller falls back to the attribute values saxes already decoded.
   */
  take(): string | null {
    const raw = this.completeOpenTags[this.nextOpenTagIndex];
    if (raw === undefined) return null;
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
    if (this.mode === 'prefix') {
      this.consumePrefix(character);
      return;
    }
    if (this.mode === 'bang') {
      this.consumeBangOpen(character);
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
      this.consumeUntilClose(character, PI_CLOSE);
      return;
    }
    if (this.mode === 'comment') {
      this.consumeUntilClose(character, COMMENT_CLOSE);
      return;
    }
    if (this.mode === 'cdata') {
      this.consumeUntilClose(character, CDATA_CLOSE);
      return;
    }
    this.consumeDoctype(character);
  }

  private consumeUntilClose(character: string, close: string): void {
    this.tail = `${this.tail}${character}`.slice(-close.length);
    if (this.tail === close) this.resetMarkup();
  }

  // The markup kind is decided by the single code point after '<'. Measuring the
  // accumulated prefix in UTF-16 code units instead skipped this decision for an
  // astral NameStartChar (XML 1.0 allows #x10000-#xEFFFF), desynchronising the
  // scanner from saxes for the rest of the document.
  private consumePrefix(character: string): void {
    this.rawOpenTag += character;
    this.tail = '';
    if (character === '/') {
      this.mode = 'close';
    } else if (character === '?') {
      this.mode = 'pi';
    } else if (character === '!') {
      this.mode = 'bang';
      this.bangOpen = '';
    } else {
      this.mode = 'open';
    }
  }

  private consumeBangOpen(character: string): void {
    this.bangOpen += character;
    if (this.bangOpen === CDATA_OPEN) {
      this.enterMarkup('cdata');
    } else if (this.bangOpen === COMMENT_OPEN) {
      this.enterMarkup('comment');
    } else if (this.bangOpen === DOCTYPE_OPEN) {
      this.enterMarkup('doctype');
    } else if (this.bangOpen.length >= MAX_BANG_OPEN_LENGTH) {
      this.resetMarkup();
    }
  }

  private enterMarkup(mode: ScannerMode): void {
    this.mode = mode;
    this.bangOpen = '';
    this.tail = '';
  }

  private consumeOpenTag(character: string): void {
    this.rawOpenTag += character;
    if (this.hasConsumedQuotedCharacter(character)) return;
    if (character === '"' || character === "'") {
      this.quote = character;
      return;
    }
    if (character !== '>') return;
    this.completeOpenTags.push(this.rawOpenTag);
    this.resetMarkup();
  }

  private consumeDoctype(character: string): void {
    if (this.mode === 'doctype') {
      this.consumeDoctypeBody(character);
      return;
    }
    if (this.mode === 'dtd') {
      this.consumeInternalSubset(character);
      return;
    }
    this.consumeInternalSubsetMarkup(character);
  }

  // saxes leaves the doctype only on '>', and only outside a quoted literal; '['
  // switches to the internal subset. There is no bracket nesting to track.
  private consumeDoctypeBody(character: string): void {
    if (this.hasConsumedQuotedCharacter(character)) return;
    if (character === '"' || character === "'") this.quote = character;
    else if (character === '[') this.mode = 'dtd';
    else if (character === '>') this.resetMarkup();
  }

  // Inside the internal subset saxes ends on the first ']' at any depth, and '>'
  // is ordinary content — an earlier depth counter here refused valid documents.
  private consumeInternalSubset(character: string): void {
    if (this.hasConsumedQuotedCharacter(character)) return;
    if (character === '"' || character === "'") this.quote = character;
    else if (character === '<') this.mode = 'dtd-waka';
    else if (character === ']') this.mode = 'doctype';
  }

  private consumeInternalSubsetMarkup(character: string): void {
    if (this.mode === 'dtd-waka') {
      this.enterInternalSubsetMarkup(character);
      return;
    }
    if (this.mode === 'dtd-bang') {
      this.consumeInternalSubsetBang(character);
      return;
    }
    if (this.mode === 'dtd-pi') {
      if (character === '?') this.mode = 'dtd-pi-ending';
      return;
    }
    if (this.mode === 'dtd-pi-ending') {
      if (character === '>') this.mode = 'dtd';
      return;
    }
    this.consumeInternalSubsetComment(character);
  }

  // The character straight after '<' decides; anything but '!' or '?' is subset text.
  private enterInternalSubsetMarkup(character: string): void {
    if (character === '!') {
      this.mode = 'dtd-bang';
      this.bangOpen = '';
      return;
    }
    this.mode = character === '?' ? 'dtd-pi' : 'dtd';
  }

  // Only '<!--' opens a subset comment; every other '<!' form is subset text that
  // a quote may still span, so it returns to the plain internal-subset state.
  private consumeInternalSubsetBang(character: string): void {
    this.bangOpen += character;
    if (this.bangOpen === '-') return;
    this.mode = this.bangOpen === COMMENT_OPEN ? 'dtd-comment' : 'dtd';
    this.bangOpen = '';
  }

  private consumeInternalSubsetComment(character: string): void {
    if (this.mode === 'dtd-comment') {
      if (character === '-') this.mode = 'dtd-comment-ending';
      return;
    }
    if (this.mode === 'dtd-comment-ending') {
      this.mode = character === '-' ? 'dtd-comment-ended' : 'dtd-comment';
      return;
    }
    // saxes calls a '--' that is not followed by '>' a malformed comment and keeps
    // reading the body, so stay in the comment rather than ending the doctype early.
    this.mode = character === '>' ? 'dtd' : 'dtd-comment';
  }

  private hasConsumedQuotedCharacter(character: string): boolean {
    if (this.quote === null) return false;
    if (character === this.quote) this.quote = null;
    return true;
  }

  private resetMarkup(): void {
    this.mode = 'text';
    this.rawOpenTag = '';
    this.bangOpen = '';
    this.quote = null;
    this.tail = '';
  }
}
