import { describe, expect, it } from 'vitest';
import { parseDxf } from './parse-dxf';

function tags(...pairs: ReadonlyArray<readonly [number, string | number]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function section(name: string, body: ReadonlyArray<string>): string {
  return [tags([0, 'SECTION'], [2, name]), ...body, tags([0, 'ENDSEC'])].join('\n');
}

function parse(...sections: ReadonlyArray<string>) {
  const result = parseDxf({
    dxfText: [...sections, tags([0, 'EOF'])].join('\n'),
    id: 'expand',
    source: 'expand.dxf',
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

function line(x: number, ...extra: ReadonlyArray<readonly [number, string | number]>): string {
  return tags([0, 'LINE'], ...extra, [10, x], [20, 0], [11, x + 10], [21, 0]);
}

function layer(name: string, color: number, flags = 0): string {
  return tags([0, 'LAYER'], [2, name], [70, flags], [62, color]);
}

function block(name: string, ...entities: ReadonlyArray<string>): string {
  return [
    tags([0, 'BLOCK'], [8, '0'], [2, name], [10, 0], [20, 0]),
    ...entities,
    tags([0, 'ENDBLK']),
  ].join('\n');
}

function insert(name: string, ...extra: ReadonlyArray<readonly [number, string | number]>): string {
  return tags([0, 'INSERT'], ...extra, [2, name], [10, 0], [20, 0]);
}

const LAYERS = section('TABLES', [
  tags([0, 'TABLE'], [2, 'LAYER']),
  layer('0', 7),
  layer('CUT', 1),
  layer('ENGRAVE', 5),
  layer('OFF', -3),
  layer('FROZEN', 2, 1),
  tags([0, 'ENDTAB']),
]);

describe('DXF content CAD does not display', () => {
  it('skips paper-space entities and whole paper-space INSERTs, and counts them', () => {
    const result = parse(
      section('BLOCKS', [block('FRAME', line(0, [8, 'CUT']))]),
      section('ENTITIES', [line(0), line(20, [67, 1]), insert('FRAME', [67, 1])]),
    );
    expect(result.pathCount).toBe(1);
    expect(result.skippedSummary).toBe('2 in paper space');
  });

  it('skips entities on off and frozen layers but keeps the off layer color for the rest', () => {
    const result = parse(
      LAYERS,
      section('ENTITIES', [
        line(0, [8, 'CUT']),
        line(20, [8, 'OFF']),
        line(40, [8, 'frozen']),
        line(60, [8, 'OFF'], [62, 3]),
      ]),
    );
    expect(result.pathCount).toBe(1);
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#ff0000']);
    expect(result.skippedSummary).toBe('3 on hidden layers');
  });

  it('hides block content that resolves to the hidden layer of its INSERT, not the rest', () => {
    const result = parse(
      LAYERS,
      section('BLOCKS', [block('PART', line(0, [8, '0']), line(20), line(40, [8, 'ENGRAVE']))]),
      section('ENTITIES', [insert('PART', [8, 'FROZEN'])]),
    );
    // Layer-0 content (named or implied) inherits FROZEN; the ENGRAVE line
    // is on its own visible layer (ezdxf: an INSERT's layer state alone
    // hides nothing).
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#0000ff']);
    expect(result.skippedSummary).toBe('2 on hidden layers');
  });

  it('lists unsupported types before the hidden-content counts', () => {
    const result = parse(
      LAYERS,
      section('ENTITIES', [
        line(0, [8, 'CUT']),
        line(20, [8, 'OFF']),
        tags([0, 'TEXT'], [8, 'CUT'], [1, 'label']),
        line(40, [67, 1]),
      ]),
    );
    expect(result.skippedSummary).toBe('1 TEXT, 1 on hidden layers, 1 in paper space');
  });
});

describe('DXF block content on layer 0', () => {
  it('takes the color of the INSERT layer, through nested INSERTs on layer 0', () => {
    const result = parse(
      LAYERS,
      section('BLOCKS', [
        block('INNER', line(0, [8, '0']), line(20)),
        block('OUTER', insert('INNER', [8, '0'])),
      ]),
      section('ENTITIES', [insert('OUTER', [8, 'CUT'], [62, 3])]),
    );
    // BYLAYER on layer 0 means the INSERT's layer (CUT, red), never the
    // INSERT's own explicit color (green), which only BYBLOCK content takes.
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#ff0000']);
    expect(result.pathCount).toBe(2);
  });

  it('keeps layer 0 color for top-level entities', () => {
    const result = parse(
      section('TABLES', [layer('0', 4)]),
      section('ENTITIES', [line(0, [8, '0']), line(20)]),
    );
    expect(result.object?.paths.map((path) => path.color)).toEqual(['#00ffff']);
  });
});

describe('DXF INSERTs that cannot be drawn', () => {
  it('counts an INSERT of an unknown block as skipped and notes it once per block', () => {
    const result = parse(
      section('ENTITIES', [line(0), insert('HOLES'), insert('HOLES'), insert('SLOTS')]),
    );
    expect(result.skippedSummary).toBe('3 INSERT');
    expect(result.notes).toEqual([
      '2× INSERT references unknown block "HOLES"',
      'INSERT references unknown block "SLOTS"',
    ]);
  });

  it('counts an INSERT cut off by the nesting cap as skipped', () => {
    const result = parse(
      section('BLOCKS', [block('LOOP', insert('LOOP'), line(0))]),
      section('ENTITIES', [insert('LOOP')]),
    );
    expect(result.skippedSummary).toBe('1 INSERT');
    expect(result.notes).toEqual([expect.stringContaining('nesting deeper than 8')]);
  });

  it('does not count the SEQEND that ends an INSERT attribute list', () => {
    const result = parse(
      section('BLOCKS', [block('TAGGED', line(0))]),
      section('ENTITIES', [
        insert('TAGGED', [66, 1]),
        tags([0, 'ATTRIB'], [10, 0], [20, 0], [40, 2], [1, 'PN-1'], [2, 'TAG'], [70, 0]),
        tags([0, 'SEQEND'], [8, '0']),
        line(20),
      ]),
    );
    expect(result.pathCount).toBe(2);
    expect(result.skippedSummary).toBe('1 ATTRIB');
  });
});
