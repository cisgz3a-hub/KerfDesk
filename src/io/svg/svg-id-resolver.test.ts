import { describe, expect, it } from 'vitest';
import { createSvgIdResolver } from './svg-id-resolver';

// Deeper than the JS call stack tolerates for a per-element recursive index.
const STACK_BREAKING_DEPTH = 50_000;

function documentElementOf(svgText: string): Element {
  return new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
}

describe('createSvgIdResolver', () => {
  it('resolves ids anywhere in the subtree and reports unknown ids as null', () => {
    const root = documentElementOf(
      `<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="outer"><rect id="inner"/></g></defs></svg>`,
    );

    const resolve = createSvgIdResolver(root);

    expect(resolve('outer')?.tagName.toLowerCase()).toBe('g');
    expect(resolve('inner')?.tagName.toLowerCase()).toBe('rect');
    expect(resolve('missing')).toBeNull();
  });

  it('returns the first element in document order when an id repeats', () => {
    // Duplicate ids are invalid SVG, but getElementById still answers with the
    // first match, and the import must not depend on traversal order.
    const root = documentElementOf(
      `<svg xmlns="http://www.w3.org/2000/svg"><g id="dup"><rect id="dup"/></g><line id="dup"/></svg>`,
    );

    expect(createSvgIdResolver(root)('dup')?.tagName.toLowerCase()).toBe('g');
  });

  it('never reads the document, so a DOM without an id index is not walked per lookup', () => {
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="tile"/></svg>`;
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    let lookupCount = 0;
    doc.getElementById = (id: string) => {
      lookupCount += 1;
      return doc.querySelector(`[id="${id}"]`);
    };

    const resolve = createSvgIdResolver(doc.documentElement);
    resolve('tile');
    resolve('tile');

    expect(resolve('tile')?.tagName.toLowerCase()).toBe('rect');
    expect(lookupCount).toBe(0);
  });

  it('indexes a deeply nested tree without overflowing the stack', () => {
    // Neither the XML parser nor jsdom's appendChild survives this depth, so the
    // fixture is a bare stand-in exposing the only two members the resolver
    // touches: getAttribute('id') and children.
    const element = (id: string | null, children: readonly Element[]): Element =>
      ({
        getAttribute: (name: string) => (name === 'id' ? id : null),
        children,
      }) as unknown as Element;
    let root = element('deep', []);
    for (let level = 0; level < STACK_BREAKING_DEPTH; level += 1) {
      root = element(null, [root]);
    }

    expect(createSvgIdResolver(root)('deep')).not.toBeNull();
  });
});
