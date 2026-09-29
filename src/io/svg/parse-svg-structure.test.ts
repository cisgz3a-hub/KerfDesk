import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

// Document structure: <use> cycles and fan-out, viewports, <switch>,
// visibility, zero stroke width, markers and text counting.
const identity = { id: 'structure', source: 'structure.svg' };
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">${content}</svg>`;

type Parser = (svgText: string) => Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', async (svgText) => parseSvg({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

const colours = (result: ParseSvgResult) => result.object?.paths.map((path) => path.color) ?? [];
const polylineCount = (result: ParseSvgResult) =>
  result.object?.paths.reduce((count, path) => count + path.polylines.length, 0) ?? 0;
const presentationNotes = (result: ParseSvgResult) =>
  result.notes.filter((note) => note.startsWith('SVG presentation:'));
const bounds = (result: ParseSvgResult) => {
  const points = (result.object?.paths ?? []).flatMap((path) =>
    path.polylines.flatMap((line) => [...line.points]),
  );
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    minX: round(Math.min(...points.map((point) => point.x))),
    minY: round(Math.min(...points.map((point) => point.y))),
    maxX: round(Math.max(...points.map((point) => point.x))),
    maxY: round(Math.max(...points.map((point) => point.y))),
  };
};

// Each level is ten <use> elements of the level below, so N levels make 10^N lines.
function fanout(levels: number): string {
  let defs = '<g id="a0"><path d="M0 0 L1 1" stroke="#ff0000"/></g>';
  for (let level = 1; level <= levels; level += 1) {
    defs += `<g id="a${level}">${`<use href="#a${level - 1}"/>`.repeat(10)}</g>`;
  }
  return svg(`<defs>${defs}</defs><use href="#a${levels}"/>`);
}

const ICON =
  '<defs><symbol id="icon" viewBox="0 0 10 20">' +
  '<rect width="10" height="20" fill="none" stroke="#ff0000"/></symbol></defs>';

describe.each(parsers)('SVG <use> expansion through %s', (_name, parse) => {
  it('skips a <use> of its own ancestor, which SVG does not render', async () => {
    const result = await parse(
      svg(
        '<g id="loop" fill="none"><path d="M1 1 L19 1" stroke="#ff0000"/><use href="#loop"/></g>',
      ),
    );
    expect(polylineCount(result)).toBe(1);
    expect(presentationNotes(result)).toEqual([
      'SVG presentation: Skipped 1 circular <use> reference(s), which SVG does not render.',
    ]);
  });

  it('skips <use> elements that reference each other', async () => {
    const result = await parse(
      svg('<use id="a" href="#b"/><use id="b" href="#a"/><path d="M1 1 L19 1" stroke="#0000ff"/>'),
    );
    expect(colours(result)).toEqual(['#0000ff']);
    expect(polylineCount(result)).toBe(1);
    expect(presentationNotes(result).join(' ')).toMatch(/Skipped 2 circular <use>/);
  });

  it('expands a <use> fan-out within the budget in full', async () => {
    expect(polylineCount(await parse(fanout(4)))).toBe(10_000);
  });

  it('refuses a <use> fan-out that multiplies past the budget', async () => {
    await expect(parse(fanout(6))).rejects.toThrow(
      /SVG <use> references expand to more than 250,000 elements/,
    );
  });
});

describe.each(parsers)('SVG viewports through %s', (_name, parse) => {
  it('fits a <symbol> viewBox into the <use> size, centred by default', async () => {
    const result = await parse(
      svg(`${ICON}<use href="#icon" x="10" y="10" width="40" height="40"/>`),
    );
    // xMidYMid meet: the 10 × 20 viewBox scales by 2 and centres across 40 wide.
    expect(bounds(result)).toEqual({ minX: 20, minY: 10, maxX: 40, maxY: 50 });
  });

  it('maps a nested <svg> viewport, with sizes as percentages of its parent', async () => {
    const result = await parse(
      svg(
        '<svg x="10" y="10" width="50%" height="20" viewBox="0 0 10 10" preserveAspectRatio="none">' +
          '<rect width="10" height="10" fill="none" stroke="#ff0000"/></svg>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 30 });
  });

  it('lets the <use> size override a referenced <svg> size', async () => {
    const result = await parse(
      svg(
        '<defs><svg id="box" width="10" height="10" viewBox="0 0 1 1">' +
          '<rect width="1" height="1" fill="none" stroke="#ff0000"/></svg></defs>' +
          '<use href="#box" width="30" height="30"/>',
      ),
    );
    expect(bounds(result)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 30 });
  });

  it('renders nothing in a viewport of zero size', async () => {
    const result = await parse(
      svg(`${ICON}<use href="#icon" width="0" height="40"/><path d="M1 1H9" stroke="#0000ff"/>`),
    );
    expect(colours(result)).toEqual(['#0000ff']);
  });
});

describe.each(parsers)('SVG render semantics through %s', (_name, parse) => {
  it('paints no stroke of zero width', async () => {
    const result = await parse(
      svg(
        '<rect width="10" height="10" fill="#0000ff" stroke="#ff0000" stroke-width="0"/>' +
          '<g style="stroke-width:0px"><path d="M1 1H9" fill="none" stroke="#00ff00"/></g>' +
          '<path d="M1 5H9" fill="none" stroke="#ff00ff" stroke-width="0.5mm"/>',
      ),
    );
    expect(colours(result)).toEqual(['#0000ff', '#ff00ff']);
  });

  it('lets a descendant set visibility back to visible, but not undo display', async () => {
    const result = await parse(
      svg(
        '<defs><path id="shown" d="M1 9H9" stroke="#00ff00" visibility="visible"/></defs>' +
          '<g visibility="hidden"><path d="M1 1H9" stroke="#0000ff" visibility="visible"/>' +
          '<path d="M1 3H9" stroke="#ff0000"/></g>' +
          '<use href="#shown" visibility="hidden"/>' +
          '<g display="none"><path d="M1 5H9" stroke="#ff00ff" visibility="visible"/></g>',
      ),
    );
    expect(colours(result)).toEqual(['#0000ff', '#00ff00']);
  });

  it('discloses markers it leaves out', async () => {
    const marker =
      '<marker id="arrow" markerWidth="10" markerHeight="10"><path d="M0 0L10 5L0 10z"/></marker>';
    const result = await parse(
      svg(
        `<defs>${marker}</defs><g fill="none" marker-end="url(#arrow)">` +
          '<path d="M1 1H9" stroke="#000000"/><line x1="1" y1="3" x2="9" y2="3" stroke="#000000"/>' +
          '<path d="M1 5H9" stroke="#000000" marker-end="none"/>' +
          '<rect width="5" height="5" fill="none" stroke="#000000"/></g>' +
          '<path d="M1 7H9" fill="none" stroke="#000000" marker-start="url(#missing)"/>',
      ),
    );
    expect(presentationNotes(result)).toEqual([
      'SVG presentation: Imported 2 SVG element(s) without their markers, such as arrowheads.',
    ]);
  });

  it('counts a text element once, whatever its tspans', async () => {
    const result = await parse(
      svg(
        '<text x="1" y="5"><tspan>one</tspan><tspan>two</tspan></text>' +
          '<path d="M1 1H9" stroke="#000000"/>',
      ),
    );
    expect(result.ignoredTextElements).toBe(1);
    expect(result.notes).toContain(
      'Ignored 1 text element(s) — convert text to paths in your editor before exporting',
    );
  });

  it('renders only the first <switch> child whose conditions hold', async () => {
    const result = await parse(
      svg(
        '<switch><title>alternatives</title>' +
          '<path d="M1 1H9" stroke="#ff0000" systemLanguage="xx"/>' +
          '<path d="M1 3H9" stroke="#0000ff" systemLanguage="fr, en"' +
          ' requiredFeatures="http://www.w3.org/TR/SVG11/feature#Shape"/>' +
          '<path d="M1 5H9" stroke="#00ff00"/></switch>',
      ),
    );
    expect(colours(result)).toEqual(['#0000ff']);
  });
});

describe('SVG <switch> through the worker stream', () => {
  // DOMPurify, which the fallback parser runs first, drops requiredExtensions.
  it('passes over children that require extensions', async () => {
    const [, parse] = parsers[1] ?? [];
    const result = await parse?.(
      svg(
        '<switch><g requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/">' +
          '<path d="M1 1H9" stroke="#ff0000"/></g><path d="M1 3H9" stroke="#0000ff"/></switch>',
      ),
    );
    expect(result === undefined ? [] : colours(result)).toEqual(['#0000ff']);
  });
});
