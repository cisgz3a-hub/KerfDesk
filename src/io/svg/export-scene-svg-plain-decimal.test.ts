import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { svgObj } from '../../ui/state/test-helpers';
import { exportSceneSvg } from './export-scene-svg';
import { svgMatrixAttribute, svgNumber } from './export-svg-paths';

// Oracle audit O8-P3-1: a 90° rotation's cosine, 6.123233995736766e-17, went
// into the exported `matrix(...)` in exponent form. SVG allows it; simple
// cutter and CAM path readers often do not. The value stays exact.
describe('SVG export writes transform numbers as plain decimals', () => {
  it.each([90, 180, 270])('a %i° rotation has no exponent in its matrix', (rotationDeg) => {
    const attribute = svgMatrixAttribute({ ...IDENTITY_TRANSFORM, rotationDeg, x: 1e-7 });
    expect(attribute).not.toMatch(/e[+-]?\d/i);
    const numbers = attribute.slice('matrix('.length, -1).split(' ').map(Number);
    const radians = (rotationDeg * Math.PI) / 180;
    expect(numbers).toEqual([
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      1e-7,
      0,
    ]);
  });

  it('keeps every digit of the value', () => {
    for (const value of [6.123233995736766e-17, 1e-7, 0.1 + 0.2, -2.5e-12, 123456.789]) {
      expect(Number(svgNumber(value))).toBe(value);
      expect(svgNumber(value)).not.toMatch(/e/i);
    }
  });

  it('a rotated object exports without an exponent', () => {
    const base = createProject();
    const square = {
      ...svgObj('square', ['#000000']),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90 },
    };
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [square],
        layers: [createLayer({ id: 'layer', color: '#000000', mode: 'line' })],
      },
    };
    const result = exportSceneSvg(project);
    if (result.kind !== 'ok') throw new Error(result.error);
    const transforms = result.value.svg.match(/transform="[^"]*"/g) ?? [];
    expect(transforms.length).toBeGreaterThan(0);
    for (const transform of transforms) expect(transform).not.toMatch(/\de[+-]?\d/i);
  });
});
