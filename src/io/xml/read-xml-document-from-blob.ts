import { DOMParser as WorkerDomParser } from 'linkedom/worker';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { RawOpenTagScanner } from './raw-open-tag-scanner';

const ACTIVE_DECLARATION_TAIL = '<!DOCTYPE'.length - 1;

export type XmlDocumentReadOptions = {
  readonly label: string;
  readonly mediaType: 'image/svg+xml' | 'text/xml';
  readonly forbidActiveDeclarations?: boolean;
};

export class XmlDocumentParseError extends Error {}
export class XmlActiveDeclarationError extends Error {}

export async function readXmlDocumentFromBlob(
  blob: Blob,
  options: XmlDocumentReadOptions,
): Promise<Document> {
  const builder = new XmlDocumentBuilder(options);
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

class XmlDocumentBuilder {
  private readonly document: Document;
  private readonly parser = new SaxesParser();
  private readonly rawOpenTags: RawOpenTagScanner;
  private readonly elements: Element[] = [];
  private declarationTail = '';
  private hasActiveDeclaration = false;
  private sawRoot = false;

  constructor(private readonly options: XmlDocumentReadOptions) {
    this.document = new WorkerDomParser().parseFromString(
      '<placeholder/>',
      options.mediaType,
    ) as unknown as Document;
    this.rawOpenTags = new RawOpenTagScanner();
    this.parser.on('opentag', (tag) => this.openTag(tag));
    this.parser.on('closetag', () => this.elements.pop());
    this.parser.on('text', (text) => this.appendText(text));
    this.parser.on('cdata', (text) => this.appendText(text));
  }

  write(text: string): void {
    if (text === '') return;
    this.recordActiveDeclarations(text);
    try {
      this.rawOpenTags.write(text);
      this.parser.write(text);
    } catch (error) {
      throw this.parseError(error);
    }
  }

  close(): Document {
    try {
      this.parser.close();
    } catch (error) {
      throw this.parseError(error);
    }
    if (this.hasActiveDeclaration) {
      throw new XmlActiveDeclarationError(`${this.options.label} active XML declaration`);
    }
    return this.document;
  }

  private recordActiveDeclarations(text: string): void {
    if (this.options.forbidActiveDeclarations !== true) return;
    const probe = `${this.declarationTail}${text}`.toUpperCase();
    this.declarationTail = probe.slice(-ACTIVE_DECLARATION_TAIL);
    if (probe.includes('<!DOCTYPE') || probe.includes('<!ENTITY')) {
      this.hasActiveDeclaration = true;
    }
  }

  private openTag(tag: SaxesTagPlain): void {
    const element = this.document.createElement(tag.name);
    applyAttributes(element, tag, this.rawOpenTags.take(), this.options.mediaType);

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

  private parseError(error: unknown): Error {
    return new XmlDocumentParseError(
      `${this.options.label} parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function applyAttributes(
  element: Element,
  tag: SaxesTagPlain,
  rawOpenTag: string | null,
  mediaType: XmlDocumentReadOptions['mediaType'],
): void {
  const replayable = replayableRawOpenTag(rawOpenTag, tag.name);
  if (replayable === null) {
    for (const [name, value] of Object.entries(tag.attributes)) element.setAttribute(name, value);
    return;
  }

  const body = replayable.slice(0, -1);
  const standalone = body.trimEnd().endsWith('/') ? replayable : `${body}/>`;
  const document = new WorkerDomParser().parseFromString(
    standalone,
    mediaType,
  ) as unknown as Document;
  for (const attribute of [...document.documentElement.attributes]) {
    element.setAttribute(attribute.name, attribute.value);
  }
}

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
