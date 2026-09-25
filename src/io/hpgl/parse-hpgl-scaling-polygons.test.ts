import { describe, expect, it } from 'vitest';
import { parseHpgl } from './index';

function parse(text: string) {
  return parseHpgl({ text, id: 'plot', source: 'design.hpgl' });
}
function artwork(text: string) {
  const result = parse(text);
  if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
  return result.object;
}

describe('HPGL physical scaling and polygon geometry', () => {
  it('supports anisotropic user units and mirrored ranges', () => {
    const object = artwork('IP0,0,4000,2000;SC0,10,0,10;SP1;PU0,0;PD10,10;');
    expect(object.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    const mirrored = artwork('IP0,0,400,400;SC10,0,0,10;SP1;PU0,0;PD10,10;');
    expect(mirrored.paths[0]?.polylines[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
    const ellipse = artwork('IP0,0,4000,2000;SC0,10,0,10;SP1;PU5,5;CI2,90;');
    expect(ellipse.bounds.maxX).toBeCloseTo(40);
    expect(ellipse.bounds.maxY).toBeCloseTo(20);
  });

  it.each([0, 50, 100])(
    'positions isotropic scaling with %s percent unused space to the left',
    (left) => {
      const object = artwork(
        `SP1;PU0,0;PD40,0;IP0,0,4000,2000;SC0,10,0,10,1,${left},50;PU0,0;PD10,10;`,
      );
      expect(object.paths[1]?.polylines[0]?.points[0]?.x).toBe(left / 2);
      expect(object.paths[1]?.polylines[0]?.points[1]?.x).toBe(left / 2 + 50);
      expect(object.bounds.maxY).toBe(50);
    },
  );

  it('supports point-factor scaling without guessing a device page', () => {
    expect(artwork('IP800,400;SC2,80,3,40,2;SP1;PU2,3;PD4,5;').bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 2,
    });
  });

  it('preserves physical current position through scaling changes and reset', () => {
    const object = artwork('SP1;PA400,0;PD800,0;IP0,0,4000,4000;SC0,10,0,10;PR1,0;SC;PR40,0;');
    expect(object.paths[0]?.polylines[0]?.points.map((point) => point.x)).toEqual([0, 10, 20, 21]);
  });

  it('updates active scaling when IP moves both known reference points', () => {
    const object = artwork('IP0,0,400,400;SC0,10,0,10;SP1;PU0,0;PD10,10;IP400,400;PD10,10;');
    expect(object.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0, y: 20 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });

  it.each([
    'SC0,10,0,10',
    'IP0,0;SC0,10,0,10',
    'IP0,0,0,400;SC0,10,0,10',
    'IP0,0,400,400;SC0,0,0,10',
    'IP0,0;SC0,0,0,1,2',
    'IP0,0,400,400;SC0,10,0,10,1,120,0',
    'IP0,0,400,400;SC0,10,0,10,3',
    'IP0,0,400,400;SC0,10,0,10,1,50',
  ])('fails incomplete or invalid physical scale %s', (commands) => {
    expect(parse(`${commands};SP1;PD1,1;`).kind).toBe('error');
  });

  it('keeps EA/ER rectangle location and pen status and preserves the rectangle buffer', () => {
    const object = artwork('SP1;PU40,80;EA120,160;PR40,0;ER40,40;PD120,80;EP;');
    expect(object.paths).toHaveLength(4);
    expect(object.paths[0]?.polylines[0]?.closed).toBe(true);
    // PU was restored after each rectangle; only explicit PD creates this stroke.
    expect(object.paths[2]?.polylines[0]?.points).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 0 },
    ]);
    expect(object.paths[3]?.polylines).toEqual(object.paths[1]?.polylines);
  });

  it('closes a polygon, restores its first point and emits no connecting travel', () => {
    const object = artwork('SP1;PU0,0;PM0;PD400,0,400,400,0,400;PM2;EP;PR40,0;');
    expect(object.paths[0]?.polylines).toEqual([
      {
        closed: true,
        points: [
          { x: 0, y: 10 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ]);
    expect(object.paths[1]?.polylines[0]?.points).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: 10 },
    ]);
  });

  it('retains holes and fill rules while EP edges only pen-down polygon segments', () => {
    const result = parse(
      'SP1;PU0,0;PM0;PD400,0;PU400,400;PD0,400;PM1;PD100,100,100,300,300,300,300,100;PM2;FP1;EP;',
    );
    if (result.kind !== 'ok' || result.object === null) throw new Error(JSON.stringify(result));
    expect(result.object.paths[0]?.fillRule).toBe('nonzero');
    expect(result.object.paths[0]?.polylines).toHaveLength(2);
    expect(result.object.paths[1]?.polylines).toHaveLength(3);
    expect(result.pathCount).toBe(5);
    expect(result.notes).toContain(
      'Filled shapes were imported as boundaries with their fill rule. Choose a Fill operation to engrave their interiors.',
    );
  });

  it('treats circles as separate subpolygons and permits buffer reuse for filling/edging', () => {
    const object = artwork('SP1;PU0,0;PM0;CI40,90;PU80,0;CI20,90;PM2;FP;EP;');
    expect(object.paths).toHaveLength(2);
    expect(object.paths[0]?.fillRule).toBe('evenodd');
    expect(object.paths[0]?.polylines).toHaveLength(2);
    expect(object.paths[1]?.polylines).toEqual(object.paths[0]?.polylines);
    expect(object.bounds.maxX).toBeCloseTo(3.5);
  });

  it('imports filled rectangle boundaries with an explicit fill note', () => {
    const result = parse('SP1;FT1;LT;PU0,0;RA80,40;RR-40,-80;');
    expect(result).toMatchObject({
      kind: 'ok',
      pathCount: 2,
      diagnostics: [{ code: 'fill-boundaries' }],
    });
    if (result.kind !== 'ok') return;
    expect(result.object?.paths.map((path) => path.fillRule)).toEqual(['evenodd', 'evenodd']);
  });

  it.each([
    'PM1',
    'PM2',
    'PM0;PD40,0',
    'PM0;SP2;PM2',
    'PM0;SC0,10,0,10;PM2',
    'PM0;PM0;PM2',
    'PM0;PD40,0;PM2;FP2',
  ])('rejects invalid polygon state %s', (commands) => {
    expect(parse(`SP1;PU0,0;${commands};`).kind).toBe('error');
  });
});
