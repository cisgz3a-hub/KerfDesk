// Rolling audit v11 W5-P2-1 (DXF) and W5-P2-2 (HPGL), ADR-307 Amendment 5:
// both importers range-checked raw input at most, not where the drawing lands
// after the shift to its corner, INSERT placement and spline evaluation. A
// drawing past the loader's 1,000,000 mm imported with no note, then Save and
// autosave refused the whole project. The importers now refuse it themselves.
import { describe, expect, it } from 'vitest';
import { createProject, type SceneObject } from '../../core/scene';
import { parseDxf } from '../dxf';
import { parseHpgl } from '../hpgl';
import { prepareProjectForPersistence } from './prepare-project-persistence';

const LINE = (x1: number, y1: number, x2: number, y2: number): string[] => [
  ...['0', 'LINE', '8', '0', '10', String(x1), '20', String(y1)],
  ...['11', String(x2), '21', String(y2)],
];

const dxf = (units: string, entities: string[]): string =>
  [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', units, '0', 'ENDSEC'],
    // Block B: one 10 mm line, for INSERT placement.
    ...['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'B', '10', '0', '20', '0'],
    ...LINE(0, 0, 10, 0),
    ...['0', 'ENDBLK', '0', 'ENDSEC'],
    ...['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'],
  ].join('\n');

const INSERT = (x: string): string[] => ['0', 'INSERT', '8', '0', '2', 'B', '10', x, '20', '0'];

// v2 14-P3-7: weights 1, -2, 1 put the curve 9.1e12 mm out.
const NEGATIVE_WEIGHT_SPLINE = [
  ...['0', 'SPLINE', '8', '0', '70', '8', '71', '2', '72', '6', '73', '3'],
  ...['40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1'],
  ...['10', '0', '20', '0', '10', '5', '20', '10', '10', '10', '20', '0'],
  ...['41', '1', '41', '-2', '41', '1'],
];

function saves(object: SceneObject): boolean {
  const base = createProject();
  const project = { ...base, scene: { ...base.scene, objects: [object] } };
  return prepareProjectForPersistence(project).kind === 'ok';
}

function expectRefused(
  result: { readonly kind: string; readonly reason?: string },
  format: string,
) {
  expect(result.kind).toBe('error');
  expect(result.reason).toMatch(new RegExp(`This ${format} drawing spans .* mm`));
  expect(result.reason).toContain('holds coordinates only up to 1,000,000 mm');
  expect(result.reason).toContain('so it could never be saved');
}

describe('DXF import refuses a drawing that lands past the project limit (W5-P2-1)', () => {
  it.each([
    [
      'two parts at X -900,000 and +900,000',
      dxf('4', [...LINE(-900000, 0, -899990, 0), ...LINE(900000, 0, 900010, 0)]),
    ],
    [
      'a part plus a stray line at X 999,000',
      dxf('4', [
        ...LINE(0, 0, 100, 0),
        ...LINE(0, 0, 0, 100),
        ...LINE(-5000, 0, -4990, 0),
        ...LINE(999000, 5, 999001, 5),
      ]),
    ],
    [
      'a site plan in metres spanning 1,009.5 m',
      dxf('6', [...LINE(0, 0, 1, 0), ...LINE(999, 0, 999.5, 0), ...LINE(-10, 0, -9.9, 0)]),
    ],
    ['an INSERT placed at X 2,000,000', dxf('4', [...INSERT('2000000'), ...LINE(0, 0, 5, 5)])],
    ['a SPLINE with a negative weight', dxf('4', NEGATIVE_WEIGHT_SPLINE)],
  ])('%s', (_label, text) => {
    const result = parseDxf({ dxfText: text, id: 'site', source: 'site.dxf' });
    expectRefused(result as { kind: string; reason?: string }, 'DXF');
  });

  it('names the extent it found', () => {
    const result = parseDxf({
      dxfText: dxf('4', [...LINE(-900000, 0, -899990, 0), ...LINE(900000, 0, 900010, 0)]),
      id: 'site',
      source: 'site.dxf',
    });
    expect(result.kind === 'error' && result.reason).toContain('spans 1,800,010 × 0 mm');
  });

  it('still imports, and saves, a drawing just inside the limit', () => {
    const result = parseDxf({
      dxfText: dxf('4', [...INSERT('900000'), ...LINE(0, 0, 5, 5)]),
      id: 'site',
      source: 'site.dxf',
    });
    if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
    expect(result.object.bounds.maxX).toBe(900010);
    expect(saves(result.object)).toBe(true);
  });
});

describe('HPGL import refuses a plot that lands past the project limit (W5-P2-2)', () => {
  const parse = (text: string) => parseHpgl({ text, id: 'plot', source: 'plot.plt' });

  it.each([
    ['two 10 mm strokes 1,025 m apart', 'IN;SP1;PU0,0;PD400,0;PU41000000,400;PD41000400,400;'],
    ['one corrupt 1e12 coordinate', 'IN;SP1;PU0,0;PD400,400;PU1000000000000,0;PD1000000000400,0;'],
  ])('%s', (_label, text) => {
    const result = parse(text);
    expectRefused(result, 'HPGL');
  });

  it('names the extent of the 1,025 m plot', () => {
    const result = parse('IN;SP1;PU0,0;PD400,0;PU41000000,400;PD41000400,400;');
    expect(result.kind === 'error' && result.reason).toContain('spans 1,025,010 × 10 mm');
  });

  it('still imports, and saves, a 300 mm plot', () => {
    const result = parse('IN;SP1;PU0,0;PD12000,0,12000,12000;');
    if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
    expect(result.object.bounds).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 300 });
    expect(saves(result.object)).toBe(true);
  });
});
