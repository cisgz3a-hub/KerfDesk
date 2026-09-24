import { describe, expect, it } from 'vitest';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { parseSvgInWorker } from './parse-svg-worker';

const args = (svgText: string) => ({ svgText, id: 'O1', source: 'test.svg' });

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">${body}</svg>`;

function expectComposedFill(result: ParseSvgResult): void {
  const filled = result.fragment?.entries[0];
  if (filled?.kind !== 'imported-svg') throw new Error('Expected fill fragment');
  expect(filled.operationOverride?.mode).toBe('fill');
  expect(filled.paths[0]?.fillRule).toBe('evenodd');
  expect(filled.paths[0]?.polylines[0]?.closed).toBe(true);
  expect(filled.paths[0]?.curves?.[0]?.closed).toBe(true);
}

function expectComposedImage(result: ParseSvgResult): void {
  const bitmap = result.fragment?.entries[1];
  if (bitmap?.kind !== 'svg-image') throw new Error('Expected image fragment');
  expect(bitmap.transform).toMatchObject({ x: 3, y: 2 });
  expect(bitmap.imageClip?.[0]?.polylines).toHaveLength(2);
  expect(result.ignoredImageElements).toBe(0);
}

function colors(svgText: string): ReadonlyArray<string> {
  return parseSvg(args(svgText)).object?.paths.map((path) => path.color) ?? [];
}

// Adobe Illustrator's internal-CSS export: classes in a <style> sheet in <defs>.
const ILLUSTRATOR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
  <defs>
    <style>
      .cls-1 {
        fill: none;
        stroke: #ff0000;
        stroke-miterlimit: 10;
      }

      .cls-2 {
        fill: #0000ff;
      }
    </style>
  </defs>
  <path class="cls-1" d="M1 1 L9 1 L9 9 Z"/>
  <path class="cls-2" d="M11 1 L19 1 L19 9 Z"/>
</svg>`;

describe('parseSvg <style> sheets', () => {
  it('imports an Illustrator internal-CSS file exactly as its presentation-attribute twin', () => {
    const twin = svg(`<path fill="none" stroke="#ff0000" d="M1 1 L9 1 L9 9 Z"/>
      <path fill="#0000ff" d="M11 1 L19 1 L19 9 Z"/>`);

    const result = parseSvg(args(ILLUSTRATOR_SVG));

    expect(result.object?.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
    expect(result.object?.paths).toEqual(parseSvg(args(twin)).object?.paths);
    expect(parseSvgInWorker(args(ILLUSTRATOR_SVG))).toEqual(result);
  });

  it('lets the style attribute beat a class rule, and a class rule beat a presentation attribute', () => {
    expect(
      colors(
        svg(`<style>.c { stroke: #ff0000 }</style>
          <path class="c" style="stroke: #0000ff" d="M0 0 L5 0"/>
          <path class="c" stroke="#00ff00" d="M0 5 L5 5"/>`),
      ),
    ).toEqual(['#0000ff', '#ff0000']);
  });

  it('lets an #id rule beat a .class rule whatever their order', () => {
    expect(
      colors(
        svg(`<style>#p { stroke: #0000ff } .c { stroke: #ff0000 }</style>
          <path id="p" class="c" d="M0 0 L5 0"/>`),
      ),
    ).toEqual(['#0000ff']);
  });

  it('inherits paint, visibility and fill-rule set by a class on a group', () => {
    const result = parseSvg(
      args(
        svg(`<style>
          .layer { fill: none; stroke: #ff0000 }
          .solid { fill: #0000ff; fill-rule: evenodd }
          .off { visibility: hidden }
        </style>
        <g class="layer"><path d="M0 0 L5 0"/><rect width="2" height="2"/></g>
        <g class="solid"><rect x="5" width="2" height="2"/></g>
        <g class="off"><path d="M0 5 L5 5" stroke="#00ff00"/></g>`),
      ),
    );

    expect(result.object?.paths.map((path) => [path.color, path.polylines.length])).toEqual([
      ['#ff0000', 2],
      ['#0000ff', 1],
    ]);
    expect(result.object?.paths[1]?.fillRule).toBe('evenodd');
  });

  it('keeps applying the rules after an @media block', () => {
    expect(
      colors(
        svg(`<style>
          @media (prefers-color-scheme: dark) { .c { stroke: #ffffff } }
          .c { stroke: #ff0000 }
        </style>
        <path class="c" d="M0 0 L5 0"/>`),
      ),
    ).toEqual(['#ff0000']);
  });

  it('applies display, opacity and transform from rules as it does from the style attribute', () => {
    const result = parseSvg(
      args(
        svg(`<style>
          .gone { display: none }
          .clear { stroke-opacity: 0 }
          .moved { transform: translate(5px, 1px) }
        </style>
        <path class="gone" stroke="#ff0000" d="M0 0 L5 0"/>
        <line class="clear" stroke="#ff0000" x1="0" y1="2" x2="5" y2="2"/>
        <path class="moved" stroke="#0000ff" d="M0 0 L5 0"/>`),
      ),
    );

    expect(result.object?.paths.map((path) => path.color)).toEqual(['#0000ff']);
    expect(result.object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: 5, y: 1 },
      { x: 10, y: 1 },
    ]);
  });

  it('styles <use> content by the rules matching its definition', () => {
    expect(
      colors(
        svg(`<defs><style>.s { fill: #00ff00 }</style><rect id="tile" class="s" width="2" height="2"/></defs>
          <use href="#tile" x="4"/>`),
      ),
    ).toEqual(['#00ff00']);
  });
});

describe('parseSvg initial fill', () => {
  it('imports a shape nothing styles with black fill, exactly like fill="#000000"', () => {
    const shapes = (fill: string) =>
      svg(`<rect x="1" y="1" width="8" height="8"${fill}/>
        <circle cx="15" cy="5" r="3"${fill}/>
        <path d="M1 9 L5 5 L9 9"${fill} stroke="none"/>`);

    const unstyled = parseSvg(args(shapes('')));

    expect(unstyled.object?.paths.map((path) => path.color)).toEqual(['#000000']);
    expect(unstyled.object?.paths[0]?.polylines).toHaveLength(3);
    expect(unstyled).toEqual(parseSvg(args(shapes(' fill="#000000"'))));
  });

  it('never fills a <line>, and an explicit none or transparent fill still paints nothing', () => {
    const result = parseSvg(
      args(
        svg(`<line x1="0" y1="0" x2="9" y2="0"/>
          <g fill="none"><rect width="5" height="5"/></g>
          <style>.hollow { fill: none }</style><rect class="hollow" width="5" height="5"/>
          <rect width="5" height="5" fill-opacity="0"/>`),
      ),
    );

    expect(result.object).toBeNull();
    expect(result.notes).toContain('SVG has no drawable geometry');
  });

  it('keeps the content of clip paths, masks, markers and patterns out of the artwork', () => {
    // Charting libraries often place <clipPath> straight under <svg>; its
    // unstyled rectangle must not become black artwork.
    const result = parseSvg(
      args(
        svg(`<clipPath id="c"><rect width="20" height="10"/></clipPath>
          <mask id="m"><rect width="20" height="10" fill="#ffffff"/></mask>
          <marker id="k"><path d="M0 0 L2 1 L0 2 Z"/></marker>
          <pattern id="p" width="2" height="2"><circle cx="1" cy="1" r="1"/></pattern>
          <path stroke="#ff0000" d="M0 0 L5 0"/>`),
      ),
    );

    expect(result.object?.paths.map((path) => path.color)).toEqual(['#ff0000']);
    expect(result.object?.paths[0]?.polylines).toHaveLength(1);
  });

  it('rejects unsupported vector clipping instead of silently importing unclipped artwork', () => {
    expect(() =>
      parseSvg(
        args(
          svg(`<style>.clipped { clip-path: url(#c) }</style>
            <clipPath id="c"><rect width="20" height="10"/></clipPath>
            <g class="clipped"><path stroke="#ff0000" d="M0 0 L5 0"/></g>`),
        ),
      ),
    ).toThrow(/vector clipping is not supported/i);
  });
});

describe('stylesheet presentation in composed SVG fragments', () => {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLSsAAAAASUVORK5CYII=';
  const image = (presentation: string) =>
    `<image ${presentation} width="4" height="4" preserveAspectRatio="none" href="${pixel}"/>`;

  it('preserves paint order, fill closure and owned image clips through the full cascade', () => {
    const definition = `<defs><clipPath id="crop" clipPathUnits="userSpaceOnUse">
      <path clip-rule="evenodd" d="M0 0H4V4H0Z M1 1H3V3H1Z"/>
    </clipPath></defs>`;
    const styled = svg(`<style>
      g.paint { fill: red; fill-rule: evenodd }
      .solid { fill: blue }
      #shape { fill: green }
      .offset { transform: translate(3px, 2px) }
      image { opacity: 25% }
      .photo { opacity: 100% !important; clip-path: url(#crop) }
      .line { fill: none; stroke: blue }
      .off { display: none }
    </style>${definition}
    <g class="paint"><path id="shape" class="solid" style="fill: orange" d="M0 0H4V4"/></g>
    <g class="offset">${image('class="photo" opacity="50%" style="opacity: 75%"')}</g>
    <path class="line" d="M12 1L18 8"/>
    ${image('class="off"')}`);
    const attributes = svg(`${definition}
      <g fill="red" fill-rule="evenodd"><path fill="orange" d="M0 0H4V4"/></g>
      <g transform="translate(3 2)">${image('clip-path="url(#crop)" opacity="1"')}</g>
      <path fill="none" stroke="blue" d="M12 1L18 8"/>
      ${image('display="none"')}`);
    const result = parseSvg(args(styled));
    expect(result).toEqual(parseSvg(args(attributes)));
    expect(parseSvgInWorker(args(styled))).toEqual(result);
    expect(result.fragment?.entries.map((entry) => entry.kind)).toEqual([
      'imported-svg',
      'svg-image',
      'imported-svg',
    ]);
    expectComposedFill(result);
    expect(result.object?.paths[0]?.polylines[0]?.closed).toBe(false);
    expectComposedImage(result);
  });

  it.each(['opacity: 50%', 'filter: url(#effect)', 'mask: url(#effect)'])(
    'rejects unsupported image presentation from ancestor rules: %s',
    (declaration) => {
      const markup = svg(`<style>.effect { ${declaration} }</style>
        <path fill="red" d="M0 0H4V4Z"/>
        <g class="effect">${image('')}</g>`);
      expect(() => parseSvg(args(markup))).toThrow(/opacity, filters and SVG masks/i);
      expect(() => parseSvgInWorker(args(markup))).toThrow(/opacity, filters and SVG masks/i);
    },
  );
});
