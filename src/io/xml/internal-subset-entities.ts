// General entities declared in a DOCTYPE's internal subset (XML 1.0 §2.8,
// §4.2). Illustrator's "Save As SVG" declares its namespace URIs, and with the
// "Entity References" option its styles, this way:
//   <!DOCTYPE svg ... [ <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/"> ]>
//   <svg xmlns:i="&ns_ai;">
// With only an internal subset and no parameter-entity references, XML 1.0
// §4.1 (WFC: Entity Declared) makes such a file well-formed. saxes reads no
// declarations, so the references failed as undefined entities.
//
// Only literal internal general entities are read. External entities
// (SYSTEM/PUBLIC), parameter entities, and values holding a reference or
// markup are ignored, so nothing is fetched and nothing expands into another
// entity: ADR-268 item 2's XXE and billion-laughs bound holds. A reference to
// an ignored entity is still an undefined entity. Declaration count, value
// length and the total expansion are bounded (ADR-268 Amendment 1).

export const INTERNAL_ENTITY_LIMITS = {
  count: 64,
  valueLength: 4096,
  // Expansion may reach this many characters, or this many times the input,
  // whichever is larger; the amplification bound expat applies by default.
  expansionFloor: 8 * 1024 * 1024,
  expansionRatio: 100,
} as const;

const PREDEFINED = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const NAME = /^[A-Za-z_:\u00c0-\uffff][-.\w:\u00b7\u00c0-\uffff]*$/;
const DECLARATION_OPENINGS = ['<!ENTITY', '<!ELEMENT', '<!ATTLIST', '<!NOTATION'];

/** Counts characters produced by entity expansion and refuses past the bound. */
export class EntityExpansionBudget {
  private expanded = 0;

  spend(characters: number, inputLength: number): void {
    this.expanded += characters;
    const limit = Math.max(
      INTERNAL_ENTITY_LIMITS.expansionFloor,
      INTERNAL_ENTITY_LIMITS.expansionRatio * inputLength,
    );
    if (this.expanded > limit) {
      throw new Error(
        `entity references expand to more than ${limit.toLocaleString('en-US')} characters; ` +
          'such files are refused because they can exhaust memory',
      );
    }
  }
}

/**
 * The literal internal general entities a DOCTYPE declares, from the text
 * between "<!DOCTYPE" and its closing ">". The first declaration of a name
 * binds (XML 1.0 §4.2).
 */
export function internalSubsetEntities(doctype: string): Map<string, string> {
  const entities = new Map<string, string>();
  const open = subsetStart(doctype);
  if (open < 0) return entities;
  const subset = doctype.slice(open + 1, doctype.lastIndexOf(']'));
  let at = 0;
  while (at < subset.length && entities.size < INTERNAL_ENTITY_LIMITS.count) {
    at = skipSpace(subset, at);
    if (at >= subset.length) break;
    const next = readMarkup(subset, at, entities);
    // XML 1.0 §5.1: after an unread parameter-entity reference, a
    // non-validating processor must not process the declarations that follow.
    if (next === null) break;
    at = next;
  }
  return entities;
}

// The internal subset opens at the first '[' outside the external ID's quotes.
function subsetStart(doctype: string): number {
  let quote: string | null = null;
  for (let at = 0; at < doctype.length; at += 1) {
    const character = doctype.charAt(at);
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      return at;
    }
  }
  return -1;
}

// Reads one comment, processing instruction or declaration; null stops.
function readMarkup(subset: string, at: number, entities: Map<string, string>): number | null {
  if (subset.startsWith('<!--', at)) return endAfter(subset, at + 4, '-->');
  if (subset.startsWith('<?', at)) return endAfter(subset, at + 2, '?>');
  const opening = DECLARATION_OPENINGS.find((word) => subset.startsWith(word, at));
  if (opening === undefined) return null;
  const end = declarationEnd(subset, at + opening.length);
  if (end === null) return null;
  if (opening === '<!ENTITY') registerEntity(subset.slice(at + opening.length, end), entities);
  return end + 1;
}

function registerEntity(body: string, entities: Map<string, string>): void {
  // name, then a quoted literal and nothing else: a '%' parameter entity or a
  // SYSTEM/PUBLIC external entity does not match.
  const match = /^\s+([^\s%"']+)\s+(?:"([^"]*)"|'([^']*)')\s*$/.exec(body);
  const name = match?.[1];
  const value = match?.[2] ?? match?.[3];
  if (name === undefined || value === undefined || !NAME.test(name)) return;
  if (PREDEFINED.has(name) || entities.has(name)) return;
  if (value.length > INTERNAL_ENTITY_LIMITS.valueLength || /[&%<]/.test(value)) return;
  entities.set(name, value);
}

// The '>' that closes a declaration, outside quoted literals.
function declarationEnd(subset: string, from: number): number | null {
  let quote: string | null = null;
  for (let at = from; at < subset.length; at += 1) {
    const character = subset.charAt(at);
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return at;
    }
  }
  return null;
}

function endAfter(text: string, from: number, close: string): number | null {
  const end = text.indexOf(close, from);
  return end < 0 ? null : end + close.length;
}

function skipSpace(text: string, from: number): number {
  let at = from;
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
  return at;
}

/**
 * `markup` with each reference to a declared entity replaced by its value.
 * Quotes in a value become character references, so the result reads the same
 * inside an attribute value of either quote style and in text.
 */
export function expandEntityReferences(
  markup: string,
  entities: ReadonlyMap<string, string>,
  budget: EntityExpansionBudget,
  inputLength: number,
): string {
  if (entities.size === 0 || !markup.includes('&')) return markup;
  return markup.replace(/&([^\s&;<>"']+);/g, (reference, name: string) => {
    const value = entities.get(name);
    if (value === undefined) return reference;
    budget.spend(value.length, inputLength);
    return value.replaceAll('"', '&#34;').replaceAll("'", '&#39;');
  });
}

const DOCTYPE_OPEN = '<!DOCTYPE';
const LITERAL_SECTION = /<!--|<!\[CDATA\[|<\?/g;
const LITERAL_SECTION_CLOSE: Readonly<Record<string, string>> = {
  '<!--': '-->',
  '<![CDATA[': ']]>',
  '<?': '?>',
};

/**
 * For a parser that ignores the internal subset (the main-thread fallback
 * sanitizes the text as HTML, which cannot read one): the document with the
 * internal subset's entities expanded and the subset itself removed from the
 * DOCTYPE. A document without an internal subset is returned unchanged.
 */
export function expandInternalSubset(text: string): string {
  const doctype = prologDoctype(text);
  if (doctype === null) return text;
  const entities = internalSubsetEntities(text.slice(doctype.start, doctype.end));
  const head = text.slice(0, doctype.subsetOpen) + text.slice(doctype.subsetClose + 1, doctype.end);
  const body = text.slice(doctype.end);
  if (entities.size === 0) return head + body;
  const budget = new EntityExpansionBudget();
  const parts: string[] = [];
  let at = 0;
  // Comments, CDATA sections and processing instructions hold no references.
  while (at < body.length) {
    LITERAL_SECTION.lastIndex = at;
    const section = LITERAL_SECTION.exec(body);
    const stop = section?.index ?? body.length;
    parts.push(expandEntityReferences(body.slice(at, stop), entities, budget, text.length));
    if (section === null) break;
    const close = LITERAL_SECTION_CLOSE[section[0]] ?? '>';
    const closeAt = body.indexOf(close, stop + section[0].length);
    at = closeAt < 0 ? body.length : closeAt + close.length;
    parts.push(body.slice(stop, at));
  }
  return head + parts.join('');
}

type PrologDoctype = {
  readonly start: number;
  readonly subsetOpen: number;
  readonly subsetClose: number;
  /** Just past the DOCTYPE's closing '>'. */
  readonly end: number;
};

// The DOCTYPE may follow only the XML declaration, comments, processing
// instructions and whitespace; null unless it has an internal subset.
function prologDoctype(text: string): PrologDoctype | null {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    at = skipSpace(text, at);
    if (text.startsWith('<?', at)) at = endAfter(text, at + 2, '?>') ?? text.length;
    else if (text.startsWith('<!--', at)) at = endAfter(text, at + 4, '-->') ?? text.length;
    else break;
  }
  if (!text.startsWith(DOCTYPE_OPEN, at)) return null;
  const open = subsetStart(text.slice(at, declarationEnd(text, at) ?? text.length));
  if (open < 0) return null;
  const subsetOpen = at + open;
  const subsetClose = subsetEnd(text, subsetOpen + 1);
  const end = subsetClose < 0 ? -1 : text.indexOf('>', subsetClose);
  if (end < 0) return null;
  return { start: at, subsetOpen, subsetClose, end: end + 1 };
}

// The ']' that closes the internal subset: declarations, comments, processing
// instructions, parameter-entity references and whitespace come before it.
function subsetEnd(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    at = skipSpace(text, at);
    const character = text.charAt(at);
    if (character === ']') return at;
    let next: number | null;
    if (text.startsWith('<!--', at)) next = endAfter(text, at + 4, '-->');
    else if (text.startsWith('<?', at)) next = endAfter(text, at + 2, '?>');
    else if (text.startsWith('<!', at)) next = (declarationEnd(text, at + 2) ?? -2) + 1;
    else if (character === '%') next = endAfter(text, at + 1, ';');
    else return -1;
    if (next === null || next <= at) return -1;
    at = next;
  }
  return -1;
}
