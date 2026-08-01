import { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { RawOpenTagScanner } from './raw-open-tag-scanner';

export async function readSvgDocumentFromBlob(blob: Blob): Promise<Document> {
  const builder = new SvgDocumentBuilder();
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder('utf-8');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      builder.write(decoder.decode(value, { stream: true }));
    }
    builder.write(decoder.decode());
    return builder.close();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

class SvgDocumentBuilder {
  private readonly document = new WorkerDomParser().parseFromString(
    '<placeholder/>',
    'image/svg+xml',
  ) as unknown as Document;
  private readonly parser = new SaxesParser();
  private readonly rawOpenTags = new RawOpenTagScanner();
  private readonly elements: Element[] = [];
  private sawRoot = false;

  constructor() {
    this.parser.on('opentag', (tag) => this.openTag(tag));
    this.parser.on('closetag', () => this.elements.pop());
    this.parser.on('text', (text) => this.appendText(text));
    this.parser.on('cdata', (text) => this.appendText(text));
  }

  write(text: string): void {
    if (text === '') return;
    try {
      this.rawOpenTags.write(text);
      this.parser.write(text);
    } catch (error) {
      throw svgParseError(error);
    }
  }

  close(): Document {
    try {
      this.parser.close();
    } catch (error) {
      throw svgParseError(error);
    }
    return this.document;
  }

  private openTag(tag: SaxesTagPlain): void {
    const element = this.document.createElement(tag.name);
    applyAttributes(element, tag, this.rawOpenTags.take());

    const parent = this.elements.at(-1);
    if (parent !== undefined) {
      parent.appendChild(element);
    } else if (!this.sawRoot) {
      this.document.replaceChild(element, this.document.documentElement);
      this.sawRoot = true;
    }
    this.elements.push(element);
  }

  private appendText(text: string): void {
    const parent = this.elements.at(-1);
    if (parent !== undefined && text !== '') parent.appendChild(this.document.createTextNode(text));
  }
}

function applyAttributes(element: Element, tag: SaxesTagPlain, rawOpenTag: string | null): void {
  // The established linkedom worker preserves some raw whitespace and character-reference
  // spellings that saxes normalizes. Keep those rare tags on linkedom so an ID/reference pair
  // cannot silently gain or lose geometry when the source moves to incremental parsing.
  // Rule 7: when the raw scan is missing or does not name this element the source stays
  // importable on the saxes values — a lost raw spelling never refuses a valid file.
  const replayable = replayableRawOpenTag(rawOpenTag, tag.name);
  if (replayable === null) {
    for (const [name, value] of Object.entries(tag.attributes)) element.setAttribute(name, value);
    return;
  }

  const body = replayable.slice(0, -1);
  const standalone = body.trimEnd().endsWith('/') ? replayable : `${body}/>`;
  const document = new WorkerDomParser().parseFromString(
    standalone,
    'image/svg+xml',
  ) as unknown as Document;
  for (const attribute of [...document.documentElement.attributes]) {
    element.setAttribute(attribute.name, attribute.value);
  }
}

// XML 1.0 §2.3 S: the characters that may follow an element name inside a tag.
const NAME_BOUNDARY_CHARACTERS = [' ', '\t', '\r', '\n', '/', '>'];

function replayableRawOpenTag(rawOpenTag: string | null, name: string): string | null {
  if (rawOpenTag === null || !rawOpenTag.startsWith(`<${name}`)) return null;
  const boundary = rawOpenTag.charAt(name.length + 1);
  if (!NAME_BOUNDARY_CHARACTERS.includes(boundary)) return null;
  return needsLegacyAttributeParsing(rawOpenTag) ? rawOpenTag : null;
}

function needsLegacyAttributeParsing(rawOpenTag: string): boolean {
  let quote: '"' | "'" | null = null;
  for (const character of rawOpenTag) {
    if (quote === null) {
      if (character === '"' || character === "'") quote = character;
    } else if (character === quote) {
      quote = null;
    } else if (
      character === '&' ||
      character === '\t' ||
      character === '\r' ||
      character === '\n' ||
      character === '\u0085' ||
      character === '\u2028'
    ) {
      return true;
    }
  }
  return false;
}

function svgParseError(error: unknown): Error {
  return new Error(`SVG parse error: ${error instanceof Error ? error.message : String(error)}`);
}
