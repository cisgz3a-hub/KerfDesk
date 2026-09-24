// Applies an SVG document's <style> sheets to the import's presentation lookup.
//
// Illustrator's internal-CSS export, many web icon sets and some Inkscape files
// colour shapes through class, id or element rules in a <style> element rather
// than presentation attributes, so reading only attributes and the style
// attribute imported them as nothing.
//
// Scope is what those exports write: type, universal, .class and #id selectors,
// compounds of them, selector lists, and descendant or child combinators. A
// selector using anything else (attributes, pseudo-classes, sibling
// combinators, namespaces) never matches, and at-rules are skipped whole, so
// neither disturbs the rules around them. Rules outrank presentation
// attributes and the style attribute outranks rules (SVG 1.1 §6.4); an
// !important declaration outranks every normal one.

/** Declarations that win for an element, given its parsed style attribute. */
export type SvgStyleCascade = (
  el: Element,
  inline: ReadonlyMap<string, string>,
) => ReadonlyMap<string, string>;

type Declaration = { readonly name: string; readonly value: string; readonly important: boolean };

type Compound = {
  readonly tag: string | null;
  readonly ids: ReadonlyArray<string>;
  readonly classes: ReadonlyArray<string>;
};

type Combinator = 'descendant' | 'child';

// combinators[i] joins compounds[i] to compounds[i + 1], read left to right.
type Selector = {
  readonly compounds: ReadonlyArray<Compound>;
  readonly combinators: ReadonlyArray<Combinator>;
  readonly specificity: number;
};

type StyleRule = {
  readonly selector: Selector;
  readonly declarations: ReadonlyArray<Declaration>;
  readonly order: number;
};

// Each rule sits in one bucket, keyed by its subject compound's most selective
// part, so an element tests only rules that could name it.
type RuleIndex = {
  readonly byId: Map<string, StyleRule[]>;
  readonly byClass: Map<string, StyleRule[]>;
  readonly byTag: Map<string, StyleRule[]>;
  readonly universal: StyleRule[];
};

type Subject = {
  readonly tag: string;
  readonly id: string | null;
  readonly classes: ReadonlyArray<string>;
};

const IDENT = String.raw`(?:--|-?[_a-zA-Z\u0080-\uffff])[-\w\u0080-\uffff]*`;
const COMPOUND = new RegExp(String.raw`^(\*|${IDENT})?((?:[.#]${IDENT})*)$`);
const COMPOUND_PART = new RegExp(String.raw`([.#])(${IDENT})`, 'g');
const PROPERTY_NAME = /^-?-?[a-z_][\w-]*$/;
const IMPORTANT = /!\s*important\s*$/i;
const CLASS_SEPARATOR = /[ \t\n\f\r]+/;
// Combinators look no further up than the import walk's own depth cap, so a
// crafted file cannot make each <use> of a deeply nested definition pay for
// its whole ancestry.
const MAX_ANCESTORS = 256;
const CLOSING = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

/** Parses every <style> sheet under `root` once, in document order. */
export function createSvgStyleCascade(root: Element): SvgStyleCascade {
  const rules: StyleRule[] = [];
  for (const sheet of Array.from(root.querySelectorAll('style'))) {
    parseStylesheet(sheet.textContent ?? '', rules);
  }
  const index = indexRules(rules);
  return (el, inline) =>
    cascadeDeclarations(rules.length === 0 ? [] : matchingRules(el, index), inline);
}

function cascadeDeclarations(
  rules: StyleRule[],
  inline: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (rules.length === 0 && ![...inline.values()].some((value) => IMPORTANT.test(value))) {
    return inline;
  }
  rules.sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order);
  const attached = [...inline].map(([name, raw]) => ({ name, ...splitImportance(raw) }));
  const ordered = [...rules.flatMap((rule) => rule.declarations), ...attached];
  const styles = new Map<string, string>();
  // Normal declarations first, then !important ones. Within each pass the
  // style attribute follows every rule and rules run by specificity, then
  // source order, so the later write is the one that wins.
  for (const important of [false, true]) {
    for (const declaration of ordered) {
      if (declaration.important === important) styles.set(declaration.name, declaration.value);
    }
  }
  return styles;
}

function splitImportance(raw: string): { readonly value: string; readonly important: boolean } {
  const match = IMPORTANT.exec(raw);
  return match === null
    ? { value: raw.trim(), important: false }
    : { value: raw.slice(0, match.index).trim(), important: true };
}

function parseStylesheet(css: string, rules: StyleRule[]): void {
  const text = withoutComments(css);
  let at = 0;
  while (at < text.length) {
    at = skipSheetNoise(text, at);
    if (at >= text.length) return;
    if (text.charAt(at) === '@') {
      at = atRuleEnd(text, at);
      continue;
    }
    const open = scanTo(text, at, '{');
    if (open >= text.length) return;
    const close = scanTo(text, open + 1, '}');
    addRules(text.slice(at, open), text.slice(open + 1, close), rules);
    at = close + 1;
  }
}

function addRules(prelude: string, body: string, rules: StyleRule[]): void {
  const declarations = parseDeclarations(body);
  if (declarations.length === 0) return;
  // Every selector in a list shares the rule's place in source order.
  const order = rules.length;
  for (const text of splitTopLevel(prelude, ',')) {
    const selector = parseSelector(text);
    if (selector !== null) rules.push({ selector, declarations, order });
  }
}

function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const text of splitTopLevel(body, ';')) {
    const colon = text.indexOf(':');
    if (colon < 0) continue;
    const name = text.slice(0, colon).trim().toLowerCase();
    const { value, important } = splitImportance(text.slice(colon + 1));
    if (PROPERTY_NAME.test(name) && value !== '') declarations.push({ name, value, important });
  }
  return declarations;
}

function parseSelector(text: string): Selector | null {
  const compounds: Compound[] = [];
  const combinators: Combinator[] = [];
  let combinator: Combinator = 'descendant';
  // Spacing '>' out makes every compound and child combinator its own token.
  const tokens = text.replaceAll('>', ' > ').trim().split(/\s+/);
  for (const token of tokens) {
    if (token === '>' && compounds.length > 0 && combinator === 'descendant') {
      combinator = 'child';
      continue;
    }
    const compound = parseCompound(token);
    if (compound === null) return null;
    if (compounds.length > 0) combinators.push(combinator);
    compounds.push(compound);
    combinator = 'descendant';
  }
  if (compounds.length === 0 || combinator === 'child') return null;
  return { compounds, combinators, specificity: specificityOf(compounds) };
}

function parseCompound(token: string): Compound | null {
  const match = COMPOUND.exec(token);
  if (match === null || token === '') return null;
  const tag = match[1];
  const ids: string[] = [];
  const classes: string[] = [];
  for (const [, kind, name] of (match[2] ?? '').matchAll(COMPOUND_PART)) {
    if (name !== undefined) (kind === '#' ? ids : classes).push(name);
  }
  return { tag: tag === undefined || tag === '*' ? null : tag.toLowerCase(), ids, classes };
}

function specificityOf(compounds: ReadonlyArray<Compound>): number {
  let ids = 0;
  let classes = 0;
  let types = 0;
  for (const compound of compounds) {
    ids += compound.ids.length;
    classes += compound.classes.length;
    if (compound.tag !== null) types += 1;
  }
  // Compared as (ids, classes, types); no real selector nears 1000 of any.
  return Math.min(ids, 999) * 1_000_000 + Math.min(classes, 999) * 1_000 + Math.min(types, 999);
}

function indexRules(rules: ReadonlyArray<StyleRule>): RuleIndex {
  const index: RuleIndex = { byId: new Map(), byClass: new Map(), byTag: new Map(), universal: [] };
  for (const rule of rules) {
    const subject = rule.selector.compounds.at(-1);
    if (subject !== undefined) bucketFor(index, subject).push(rule);
  }
  return index;
}

function bucketFor(index: RuleIndex, subject: Compound): StyleRule[] {
  const [id] = subject.ids;
  const [className] = subject.classes;
  if (id !== undefined) return bucket(index.byId, id);
  if (className !== undefined) return bucket(index.byClass, className);
  if (subject.tag !== null) return bucket(index.byTag, subject.tag);
  return index.universal;
}

function bucket(buckets: Map<string, StyleRule[]>, key: string): StyleRule[] {
  const existing = buckets.get(key);
  if (existing !== undefined) return existing;
  const created: StyleRule[] = [];
  buckets.set(key, created);
  return created;
}

function matchingRules(el: Element, index: RuleIndex): StyleRule[] {
  const subject = subjectOf(el);
  const candidates = [
    ...(subject.id === null ? [] : (index.byId.get(subject.id) ?? [])),
    ...subject.classes.flatMap((name) => index.byClass.get(name) ?? []),
    ...(index.byTag.get(subject.tag) ?? []),
    ...index.universal,
  ];
  let ancestors: ReadonlyArray<Subject> | undefined;
  return candidates.filter((rule) => {
    const { compounds } = rule.selector;
    const last = compounds.at(-1);
    if (last === undefined || !matchesCompound(subject, last)) return false;
    if (compounds.length === 1) return true;
    ancestors ??= ancestorSubjects(el);
    return matchesAncestors(rule.selector, ancestors);
  });
}

function subjectOf(el: Element): Subject {
  const classes = (el.getAttribute('class') ?? '').split(CLASS_SEPARATOR);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute('id'),
    // Deduplicated so a repeated class cannot list its rules twice.
    classes: [...new Set(classes)].filter((name) => name !== ''),
  };
}

function ancestorSubjects(el: Element): Subject[] {
  const subjects: Subject[] = [];
  let node = el.parentElement;
  while (node !== null && subjects.length < MAX_ANCESTORS) {
    subjects.push(subjectOf(node));
    node = node.parentElement;
  }
  return subjects;
}

function matchesCompound(subject: Subject, compound: Compound): boolean {
  return (
    (compound.tag === null || compound.tag === subject.tag) &&
    compound.ids.every((id) => id === subject.id) &&
    compound.classes.every((name) => subject.classes.includes(name))
  );
}

// Walks the compounds right to left, keeping every ancestor depth (-1 being
// the element itself) where the part matched so far can end. That stays
// linear in tree depth per compound, where backtracking is exponential for a
// crafted selector.
function matchesAncestors(selector: Selector, ancestors: ReadonlyArray<Subject>): boolean {
  let depths: ReadonlyArray<number> = [-1];
  for (let index = selector.compounds.length - 2; index >= 0; index -= 1) {
    const compound = selector.compounds[index];
    if (compound === undefined) return false;
    depths = reachableDepths(depths, selector.combinators[index], ancestors).filter((depth) => {
      const ancestor = ancestors[depth];
      return ancestor !== undefined && matchesCompound(ancestor, compound);
    });
    if (depths.length === 0) return false;
  }
  return true;
}

// A child combinator reaches the parent of a matched depth; a descendant one
// reaches every ancestor above the shallowest match. Depths stay ascending.
function reachableDepths(
  depths: ReadonlyArray<number>,
  combinator: Combinator | undefined,
  ancestors: ReadonlyArray<Subject>,
): number[] {
  if (combinator === 'child') return depths.map((depth) => depth + 1);
  return ancestors.map((_, depth) => depth).slice((depths[0] ?? -1) + 1);
}

function withoutComments(css: string): string {
  let text = '';
  let from = 0;
  let at = 0;
  while (at < css.length) {
    const char = css.charAt(at);
    if (char === '"' || char === "'") {
      at = stringEnd(css, at);
    } else if (char === '/' && css.charAt(at + 1) === '*') {
      // A comment yields no token, so `.a/**/.b` stays the compound `.a.b`.
      const close = css.indexOf('*/', at + 2);
      text += css.slice(from, at);
      at = close < 0 ? css.length : close + 2;
      from = at;
    } else {
      at += char === '\\' ? 2 : 1;
    }
  }
  return text + css.slice(from);
}

// Whitespace and the legacy <!-- --> markers some files wrap a sheet in.
function skipSheetNoise(text: string, from: number): number {
  let at = from;
  for (;;) {
    if (/\s/.test(text.charAt(at))) at += 1;
    else if (text.startsWith('<!--', at)) at += 4;
    else if (text.startsWith('-->', at)) at += 3;
    else return at;
  }
}

// A statement at-rule (@import, @charset) ends at its semicolon; a block one
// (@media, @font-face, @keyframes) at the brace that closes its block.
function atRuleEnd(text: string, start: number): number {
  const end = scanTo(text, start, ';{');
  if (text.charAt(end) !== '{') return end + 1;
  return scanTo(text, end + 1, '}') + 1;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start <= text.length; ) {
    const end = scanTo(text, start, separator);
    parts.push(text.slice(start, end));
    start = end + 1;
  }
  return parts;
}

// Index of the first `stops` character outside strings and nested brackets,
// or text.length when there is none, so an unclosed block runs to the end.
function scanTo(text: string, from: number, stops: string): number {
  const closers: string[] = [];
  let at = from;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '"' || char === "'") {
      at = stringEnd(text, at);
      continue;
    }
    if (closers.length === 0 && stops.includes(char)) return at;
    const closer = CLOSING.get(char);
    if (closer !== undefined) closers.push(closer);
    else if (char === closers.at(-1)) closers.pop();
    at += char === '\\' ? 2 : 1;
  }
  return text.length;
}

// A CSS string ends at its closing quote; an unescaped newline also ends it.
function stringEnd(text: string, start: number): number {
  const quote = text.charAt(start);
  let at = start + 1;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === quote) return at + 1;
    if (char === '\n') return at;
    at += char === '\\' ? 2 : 1;
  }
  return text.length;
}
