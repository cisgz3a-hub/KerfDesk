import { describe, expect, it } from 'vitest';
import { createSvgIdResolver } from './svg-id-resolver';
import { svgObjectBoundingBox } from './svg-object-bbox';
import { createSvgStyleCascade } from './svg-stylesheet';

// The box an objectBoundingBox clip measures, for the element with `id`.
function boxOf(content: string, id: string) {
  const document = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`,
    'image/svg+xml',
  );
  const root = document.documentElement;
  const resolveId = createSvgIdResolver(root);
  const element = resolveId(id);
  if (element === null) throw new Error(`no #${id}`);
  return svgObjectBoundingBox(element, resolveId, createSvgStyleCascade(root));
}

describe('svgObjectBoundingBox', () => {
  it('measures a <symbol> through its viewBox and the <use> size', () => {
    const box = boxOf(
      '<defs><symbol id="icon" viewBox="0 0 10 20"><rect width="10" height="20"/></symbol></defs>' +
        '<g id="target"><use href="#icon" x="10" y="10" width="40" height="40"/></g>',
      'target',
    );
    expect(box).toEqual({ minX: 20, minY: 10, maxX: 40, maxY: 50 });
  });

  it('measures a nested <svg> through its viewport', () => {
    const box = boxOf(
      '<g id="target"><svg x="10" y="10" width="50" height="50" viewBox="0 0 10 10">' +
        '<rect width="10" height="10"/></svg></g>',
      'target',
    );
    expect(box).toEqual({ minX: 10, minY: 10, maxX: 60, maxY: 60 });
  });

  it('leaves out a circular <use>, as the import does', () => {
    const box = boxOf(
      '<g id="target"><rect x="1" y="2" width="3" height="4"/><use href="#target" x="50"/></g>',
      'target',
    );
    expect(box).toEqual({ minX: 1, minY: 2, maxX: 4, maxY: 6 });
  });

  it('measures only the <switch> child that renders', () => {
    const box = boxOf(
      '<g id="target"><switch><rect width="5" height="5"/><rect width="90" height="90"/></switch></g>',
      'target',
    );
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 5 });
  });

  it('refuses a <use> fan-out past the expansion budget', () => {
    let defs = '<g id="a0"><rect width="1" height="1"/></g>';
    for (let level = 1; level <= 6; level += 1) {
      defs += `<g id="a${level}">${`<use href="#a${level - 1}"/>`.repeat(10)}</g>`;
    }
    expect(() =>
      boxOf(`<defs>${defs}</defs><g id="target"><use href="#a6"/></g>`, 'target'),
    ).toThrow(/SVG <use> references expand to more than/);
  });
});
