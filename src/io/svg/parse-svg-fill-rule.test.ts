import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';

const OVERLAP = 'M0 0H10V10H0Z M5 0H15V10H5Z';
function parse(body: string, attributes = '') {
  const result = parseSvg({
    id: 'svg',
    source: 'fill.svg',
    svgText: `<svg xmlns="http://www.w3.org/2000/svg" width="15mm" height="10mm" viewBox="0 0 15 10" ${attributes}>${body}</svg>`,
  });
  if (result.object === null) throw new Error('Expected imported geometry');
  return result.object;
}

describe('SVG explicit fill-rule authority', () => {
  it('preserves nonzero on the path containing overlapping subpaths', () => {
    const object = parse(`<path fill="black" fill-rule="nonzero" d="${OVERLAP}"/>`);
    expect(object.paths).toHaveLength(1);
    expect(object.paths[0]?.fillRule).toBe('nonzero');
    expect(object.paths[0]?.curves).toHaveLength(2);
  });

  it('inherits root and group rules, while inline style overrides the presentation attribute', () => {
    const object = parse(
      `<g fill-rule="evenodd"><path fill="red" d="${OVERLAP}"/>
      <path fill="blue" fill-rule="evenodd" style="fill-rule: nonzero !important" d="${OVERLAP}"/></g>
      <path fill="green" d="${OVERLAP}"/>`,
      'fill-rule="nonzero"',
    );
    const rules = Object.fromEntries(object.paths.map((path) => [path.color, path.fillRule]));
    expect(rules).toEqual({ '#ff0000': 'evenodd', '#0000ff': 'nonzero', '#008000': 'nonzero' });
  });

  it('keeps incompatible same-color fill rules in separate paths', () => {
    const object = parse(`<path fill="black" fill-rule="nonzero" d="${OVERLAP}"/>
      <path fill="black" fill-rule="evenodd" d="${OVERLAP}"/>
      <path fill="black" d="${OVERLAP}"/>`);
    expect(object.paths.map((path) => path.fillRule)).toEqual(['nonzero', 'evenodd', undefined]);
    expect(object.paths.every((path) => path.color === '#000000')).toBe(true);
    expect(object.paths.every((path) => path.curves?.length === 2)).toBe(true);
  });

  it('inherits the use instance rule without rendering the unused definition', () => {
    const object = parse(`<defs><path id="letters" fill="black" d="${OVERLAP}"/></defs>
      <use href="#letters" fill-rule="nonzero"/>`);
    expect(object.paths).toHaveLength(1);
    expect(object.paths[0]?.fillRule).toBe('nonzero');
  });

  it('keeps absent-rule imports on the established legacy policy', () => {
    const object = parse(`<path fill="black" d="${OVERLAP}"/>`);
    expect(object.paths[0]).not.toHaveProperty('fillRule');
  });

  it('keeps separate explicit-rule elements independent even with identical colours and rules', () => {
    const object = parse(
      `<path fill="black" d="M0 0H10V10H0Z"/>
      <path fill="black" d="M5 0V10H15V0Z"/>`,
      'fill-rule="nonzero"',
    );
    expect(object.paths).toHaveLength(2);
    expect(object.paths.every((path) => path.fillRule === 'nonzero')).toBe(true);
    expect(object.paths.every((path) => path.curves?.length === 1)).toBe(true);
  });
});
