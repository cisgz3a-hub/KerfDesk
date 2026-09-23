import { describe, expect, it } from 'vitest';
import { HPGL_IMPORT_LIMITS, parseHpgl } from './index';

function parse(text: string) {
  return parseHpgl({ text, id: 'plot', source: 'design.plt' });
}
function artwork(text: string) {
  const result = parse(text);
  if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
  return result.object;
}

describe('strict HPGL geometry import', () => {
  it('closes a full-turn AA arc exactly for subsequent filling and editing', () => {
    const object = artwork('SP1;PU40,0;PD;AA0,0,360,90;');
    expect(object.paths[0]?.polylines).toEqual([
      {
        closed: true,
        points: [
          { x: 2, y: 1 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 2 },
        ],
      },
    ]);
  });
  it('imports the primary HP triangle example at 40 units/mm, with a reflected Y axis', () => {
    const object = artwork('IN;SP1;PA10,10;PD2500,10,10,1500,10,10;');
    expect(object).toMatchObject({
      kind: 'imported-svg',
      id: 'plot',
      source: 'design.plt',
      bounds: { minX: 0, minY: 0, maxX: 62.25, maxY: 37.25 },
    });
    expect(object.paths[0]?.polylines).toEqual([
      {
        closed: true,
        points: [
          { x: 0, y: 37.25 },
          { x: 62.25, y: 37.25 },
          { x: 0, y: 0 },
        ],
      },
    ]);
    expect(object.paths[0]?.curves?.[0]?.closed).toBe(true);
  });

  it('accepts lowercase, adjacent commands, sign/space separators and fractional coordinates', () => {
    const object = artwork('in sp1 pu-40,-80pd+40+0 80 +40pr -40-40;');
    expect(object.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0, y: 3 },
      { x: 2, y: 1 },
      { x: 3, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(artwork('SP1;PU.5,-.5;PD40.5,39.5').bounds).toMatchObject({ maxX: 1, maxY: 1 });
  });

  it('preserves stroke and repeated pen order without adding pen-up travel', () => {
    const result = parse(
      'IN;SP1;PU0,0;PD40,0;PU400,0;PD440,0;SP2;PD440,40;SP1;PD400,40;SP0;PD1000,1000;',
    );
    if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
    expect(result.object.paths.map((path) => path.color)).toEqual([
      '#000000',
      '#000000',
      '#ff0000',
      '#000000',
    ]);
    expect(result.object.bounds).toMatchObject({ maxX: 11, maxY: 1 });
    expect(result.pathCount).toBe(4);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('physical plotter palette'),
        expect.stringContaining('SP0'),
      ]),
    );
  });

  it('keeps different pen identities distinct even when their numeric IDs share a palette hash', () => {
    const object = artwork('SP9;PD40,0;SP16777224;PD80,0;SP9;PD120,0;');
    const colors = object.paths.map((path) => path.color);
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[2]).toBe(colors[0]);
  });

  it('resets drawing state without erasing earlier artwork or the selected pen', () => {
    const object = artwork('IN;SP2;PU0,0;PD40,0;IN;PD0,40;');
    expect(object.paths.map((path) => path.color)).toEqual(['#ff0000', '#ff0000']);
    expect(object.paths[1]?.polylines[0]?.points).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]);
  });

  it('handles quoted comments without interpreting their apparent drawing commands', () => {
    const object = artwork('CO "PD10,20; LBignored text";IN;SP1;PU0,0;PD40,0;CO "end";');
    expect(object.bounds.maxX).toBe(1);
  });

  it('returns an empty result when all movement is pen-up or no pen is selected', () => {
    expect(parse('IN;PU40,40;PD80,80;')).toMatchObject({
      kind: 'ok',
      object: null,
      pathCount: 0,
      diagnostics: [{ code: 'unselected-pen' }],
    });
    expect(parse('IN;SP1;PU40,40;')).toMatchObject({ kind: 'ok', object: null, pathCount: 0 });
  });

  it('uses circle chord angles and restores the current position and pen-down status', () => {
    const object = artwork('SP1;PU400,800;PD;CI40,90;PR40,0;');
    expect(object.paths[0]?.polylines[0]?.closed).toBe(true);
    const circle = object.paths[0]!.polylines[0]!.points;
    expect(circle).toHaveLength(4);
    for (const [index, expected] of [
      [0, [2, 1]],
      [1, [1, 0]],
      [2, [0, 1]],
      [3, [1, 2]],
    ] as const) {
      expect(circle[index]?.x).toBeCloseTo(expected[0]);
      expect(circle[index]?.y).toBeCloseTo(expected[1]);
    }
    expect(object.paths[1]?.polylines[0]?.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(artwork('SP1;PU0,0;CI40,90;PR40,0;').paths).toHaveLength(1);
    expect(artwork('SP1;PU0,0;CI-40,90;').paths[0]?.polylines[0]?.points[0]?.x).toBe(0);
  });

  it('evaluates absolute and relative arc centres, signed sweeps and final positions', () => {
    const object = artwork('SP1;PU40,0;PD;AA0,0,90,45;AR0,-40,-90,45;PR40,0;');
    const points = object.paths[0]!.polylines[0]!.points;
    expect(points[0]?.x).toBeCloseTo(1);
    expect(points[1]?.x).toBeCloseTo(Math.SQRT1_2);
    expect(points[1]?.y).toBeCloseTo(1 - Math.SQRT1_2);
    expect(points[2]?.x).toBeCloseTo(0);
    expect(points[2]?.y).toBeCloseTo(0);
    expect(points[4]?.x).toBeCloseTo(1);
    expect(points[4]?.y).toBeCloseTo(1);
    expect(points[points.length - 1]?.x).toBeCloseTo(2);
    expect(points[points.length - 1]?.y).toBeCloseTo(1);
    const penUp = artwork('SP1;PU40,0;AA0,0,90;PD0,80;');
    expect(penUp.paths).toHaveLength(1);
    expect(penUp.bounds.maxY).toBeCloseTo(1);
  });

  it.each([
    'LBhello\u0003',
    'IW0,0,40,40',
    'SM*',
    'PEabc',
    'RO90',
    'PW1',
    'BZ1,2,3,4,5,6',
    'DT@',
    'VS40',
    'PG',
  ])('rejects unsupported %s without returning partial geometry', (unsupported) => {
    const text = `SP1;PU0,0;PD40,0;${unsupported};`;
    const result = parse(text);
    expect(result).toMatchObject({
      kind: 'error',
      diagnostics: [
        {
          code: 'unsupported-command',
          severity: 'error',
          offset: 17,
          command: unsupported.slice(0, 2),
        },
      ],
    });
    expect(result).not.toHaveProperty('object');
  });

  it.each([
    'PD1,2,3',
    'PD1,,2',
    'PD1,2,',
    'PD1.2.3,4',
    'PD1e3,4',
    'PDNaN,4',
    'PDInfinity,4',
    'PD,1,2',
    'PD0x10,20',
    'SP1.5',
    'SP-1',
    'CI0',
    'AA0,0,90,0',
    'AA0,0,99999',
    'CO "unfinished',
    '\u001b%0B',
    `PD${'9'.repeat(309)},0`,
  ])('rejects malformed or unsupported numeric syntax %s', (bad) => {
    const result = parse(`SP1;PU0,0;PD40,0;${bad};`);
    expect(result.kind).toBe('error');
    expect(result).not.toHaveProperty('object');
  });

  it.each(['LT0', 'LT1', 'LT99', 'FT3', 'FT4,40,45'])('rejects unsupported styling %s', (style) => {
    expect(parse(`${style};SP1;PD40,0;`)).toMatchObject({
      kind: 'error',
      diagnostics: [{ severity: 'error' }],
    });
  });

  it('bounds source size, generated arc work and repeated polygon output expansion', () => {
    expect(parse(' '.repeat(HPGL_IMPORT_LIMITS.textLength + 1))).toMatchObject({
      kind: 'error',
      diagnostics: [{ code: 'limit-exceeded' }],
    });
    expect(parse(`SP1;PU40,0;PD;${'AA0,0,32767,.5;'.repeat(5)}`)).toMatchObject({
      kind: 'error',
      diagnostics: [{ code: 'limit-exceeded' }],
    });
    expect(parse(`SP1;PM0;CI40,.5;PM2;${'EP;'.repeat(350)}`)).toMatchObject({
      kind: 'error',
      diagnostics: [{ code: 'limit-exceeded' }],
    });
  });
});
