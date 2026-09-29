// <switch> renders only its first direct child whose conditional processing
// attributes evaluate to true (SVG 2 struct.html#SwitchElement). Rendering every
// child imported each alternative on top of the others. KerfDesk supports no
// extensions, so requiredExtensions is false; SVG 2 removed requiredFeatures,
// which browsers now treat as true.

// Children that can render; <title>, <desc>, <defs> and the like are passed over.
const RENDERABLE = new Set([
  'a',
  'circle',
  'ellipse',
  'foreignobject',
  'g',
  'image',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'svg',
  'switch',
  'text',
  'use',
]);

/** The children an element renders: all of them, or a <switch>'s chosen one. */
export function svgRenderedChildren(element: Element): Element[] {
  if (element.tagName.toLowerCase() !== 'switch') return Array.from(element.children);
  const languages = userLanguages();
  const chosen = Array.from(element.children).find(
    (child) => RENDERABLE.has(child.tagName.toLowerCase()) && conditionsHold(child, languages),
  );
  return chosen === undefined ? [] : [chosen];
}

function conditionsHold(element: Element, languages: readonly string[]): boolean {
  if (element.hasAttribute('requiredExtensions')) return false;
  const systemLanguage = element.getAttribute('systemLanguage');
  return systemLanguage === null || languageMatches(systemLanguage, languages);
}

// True when a user language equals a listed tag, or is a prefix of one that
// the next character is "-" after, ignoring case; an empty list is false
// (SVG 2 struct.html#ConditionalProcessingSystemLanguageAttribute).
function languageMatches(value: string, languages: readonly string[]): boolean {
  const tags = value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== '');
  return tags.some((tag) =>
    languages.some((language) => tag === language || tag.startsWith(language + '-')),
  );
}

// The user's preferred languages, as the browser (or worker) reports them.
function userLanguages(): readonly string[] {
  const navigator = (
    globalThis as { navigator?: { languages?: readonly string[]; language?: string } }
  ).navigator;
  const listed =
    navigator?.languages ?? (navigator?.language === undefined ? [] : [navigator.language]);
  const languages = listed.map((language) => language.toLowerCase());
  return languages.length > 0 ? languages : ['en'];
}
