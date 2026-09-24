import { describe, expect, it } from 'vitest';
import { createSvgStyleCascade } from './svg-stylesheet';

// Cascaded declarations for the first element `target` selects, as a plain
// object so a mismatch diffs readably.
function stylesFor(
  body: string,
  target = 'path',
  inline: ReadonlyMap<string, string> = new Map(),
): Record<string, string> {
  const root = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
    'image/svg+xml',
  ).documentElement;
  const el = root.querySelector(target);
  if (el === null) throw new Error(`fixture has no ${target}`);
  return Object.fromEntries(createSvgStyleCascade(root)(el, inline));
}

describe('createSvgStyleCascade', () => {
  it('reads CDATA-wrapped and multiple sheets wherever they sit in the document', () => {
    const body = `<defs><style><![CDATA[ .a > .b { opacity: 0.5 } .b { stroke: #ff0000 } ]]></style></defs>
      <g class="a"><path class="b c"/></g>
      <g><style>.c { fill: #0000ff }</style></g>`;

    expect(stylesFor(body)).toEqual({ opacity: '0.5', stroke: '#ff0000', fill: '#0000ff' });
  });

  it('matches type, universal, class, id, compound and listed selectors', () => {
    const styles = stylesFor(`<style>
      * { opacity: 0.5 }
      path { stroke-opacity: 0.25 }
      .x.y { fill: #00ff00 }
      path#p { stroke: #ff0000 }
      rect, .y { fill-rule: evenodd }
      .x.z, circle#p { display: none }
    </style>
    <path id="p" class="x  y"/>`);

    expect(styles).toEqual({
      opacity: '0.5',
      'stroke-opacity': '0.25',
      fill: '#00ff00',
      stroke: '#ff0000',
      'fill-rule': 'evenodd',
    });
  });

  it('ranks rules by specificity, then source order, beneath the style attribute', () => {
    const styles = stylesFor(
      `<style>
        #p { fill: #0000ff }
        .c { fill: #ff0000; stroke: #ff0000 }
        path { fill: #000000; stroke: #000000; opacity: 0.5 }
        .c { stroke: #00ff00 }
      </style>
      <path id="p" class="c"/>`,
      'path',
      new Map([['opacity', '0.25']]),
    );

    expect(styles).toEqual({ fill: '#0000ff', stroke: '#00ff00', opacity: '0.25' });
  });

  it('lifts !important rules over the style attribute, and an important style attribute over both', () => {
    const styles = stylesFor(
      `<style>
        .c { fill: #ff0000 !important; stroke: #ff0000 ! IMPORTANT }
        #p { fill: #0000ff }
      </style>
      <path id="p" class="c"/>`,
      'path',
      new Map([
        ['fill', '#00ff00'],
        ['stroke', '#00ff00 !important'],
      ]),
    );

    expect(styles).toEqual({ fill: '#ff0000', stroke: '#00ff00' });
  });

  it('strips !important from the style attribute of a document without a sheet', () => {
    const inline = new Map([
      ['display', 'none !important'],
      ['stroke', '#ff0000'],
    ]);

    expect(stylesFor('<path/>', 'path', inline)).toEqual({ display: 'none', stroke: '#ff0000' });
  });

  it('matches descendant and child combinators against every ancestor, not only the nearest', () => {
    // The nearest <g> above the path has a plain <g> parent; only the middle
    // one sits directly inside .x, so a matcher that commits to the first
    // ancestor misses this rule.
    const body = `<style>
        g.x > g path { fill: #ff0000 }
        .x > path { opacity: 0.5 }
        svg > path { stroke: #0000ff }
      </style>
      <g class="x"><g><g><path class="nested"/></g></g></g>
      <path class="top"/>`;

    expect(stylesFor(body, 'path.nested')).toEqual({ fill: '#ff0000' });
    expect(stylesFor(body, 'path.top')).toEqual({ stroke: '#0000ff' });
  });

  it('keeps a long descendant chain over deep nesting linear instead of backtracking', () => {
    // Backtracking tries every way to place 15 <g> compounds among 30
    // ancestors (about 10^8) before .missing fails, far past the test timeout;
    // tracking reachable depths answers at once.
    const depth = 30;
    const selector = `.missing ${'g '.repeat(15)}path`;
    const body = `<style>${selector} { fill: #ff0000 } path { stroke: #0000ff }</style>${'<g>'.repeat(depth)}<path/>${'</g>'.repeat(depth)}`;

    expect(stylesFor(body)).toEqual({ stroke: '#0000ff' });
  });

  it('tokenizes a selector holding a huge whitespace run in linear time', () => {
    // Spacing out '>' with a \s*>\s* regex rescans the run from every
    // position, which is quadratic: tens of seconds for this sheet.
    const body = `<style>svg${' '.repeat(150_000)}path { stroke: #ff0000 }</style><path/>`;

    expect(stylesFor(body)).toEqual({ stroke: '#ff0000' });
  });

  it('reads no more than 256 ancestors, so every <use> of a deep definition stays cheap', () => {
    const depth = 1_000;
    const root = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><style>g path { stroke: #ff0000 }</style>${'<g>'.repeat(depth)}<path/>${'</g>'.repeat(depth)}</svg>`,
      'image/svg+xml',
    ).documentElement;
    const outermost = root.querySelector('g')!;
    const reads: string[] = [];
    const nativeGetAttribute = outermost.getAttribute.bind(outermost);
    outermost.getAttribute = (name: string) => {
      reads.push(name);
      return nativeGetAttribute(name);
    };

    const styles = createSvgStyleCascade(root)(root.querySelector('path')!, new Map());

    expect(Object.fromEntries(styles)).toEqual({ stroke: '#ff0000' });
    expect(reads).toEqual([]);
  });

  it('skips at-rules, comments and unsupported selectors without losing the rules around them', () => {
    const styles = stylesFor(`<style><![CDATA[
      <!--
      @charset "utf-8";
      @import url("theme.css");
      /* .c { fill: #000000 } with a stray { brace */
      @media (prefers-color-scheme: dark) { .c { stroke: #ffffff } }
      @font-face { font-family: "A;B}"; src: url(data:font/woff2;base64,AAAA) }
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
      path:hover, .c[data-x], g + .c, g ~ .c, svg|path, .c::before, .c { stroke: #ff0000 }
      .c { font-family: "}"; fill: url(data:image/png;base64,AA==); bogus; : empty; stroke-width: 2 }
      .c/* a comment is no combinator */.d { opacity: 0.5 }
      -->
    ]]></style>
    <path class="c d"/>`);

    expect(styles).toEqual({
      stroke: '#ff0000',
      opacity: '0.5',
      'font-family': '"}"',
      fill: 'url(data:image/png;base64,AA==)',
      'stroke-width': '2',
    });
  });

  it('applies a final block that the sheet never closes', () => {
    expect(
      stylesFor('<style>.a { stroke: #0000ff } .c { stroke: #ff0000</style><path class="c"/>'),
    ).toEqual({ stroke: '#ff0000' });
  });
});
