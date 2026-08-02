// Resolves `<use href="#id">` targets against a document's id table.
//
// Document.getElementById is an indexed O(1) lookup in a browser, but linkedom —
// the DOM the import worker parses with (src/io/svg/parse-svg-worker.ts) — keeps
// no id index and walks the whole tree per call. A file with U <use> elements
// over N nodes therefore costs O(U·N). Building the table once on the first
// resolution makes the whole import O(N + U); a file with no <use> at all never
// builds it.

export type SvgIdResolver = (id: string) => Element | null;

export function createSvgIdResolver(root: Element): SvgIdResolver {
  let index: Map<string, Element> | null = null;
  return (id: string): Element | null => {
    index ??= indexElementIds(root);
    return index.get(id) ?? null;
  };
}

function indexElementIds(root: Element): Map<string, Element> {
  const index = new Map<string, Element>();
  // Explicit stack with children pushed in reverse: document order without
  // recursion, so a pathologically deep SVG cannot overflow the JS stack.
  const stack: Element[] = [root];
  for (;;) {
    const el = stack.pop();
    if (el === undefined) return index;
    const id = el.getAttribute('id');
    // First declaration in document order wins, matching what getElementById
    // returns for a document that (invalidly) repeats an id.
    if (id !== null && id !== '' && !index.has(id)) index.set(id, el);
    const children = Array.from(el.children);
    for (let position = children.length - 1; position >= 0; position -= 1) {
      const child = children[position];
      if (child !== undefined) stack.push(child);
    }
  }
}
