import { describe, expect, it } from 'vitest';
import { MAX_MINSERT_INSTANCES } from './dxf-insert-grid';
import { parseDxf } from './parse-dxf';

const GRID_ROWS = 100;

function tags(...pairs: ReadonlyArray<readonly [number, string]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function section(name: string, body: string): string {
  return [tags([0, 'SECTION'], [2, name]), body, tags([0, 'ENDSEC'])].join('\n');
}

describe('DXF MINSERT budget', () => {
  it('skips a grid above the bounded instance budget', () => {
    const columns = MAX_MINSERT_INSTANCES / GRID_ROWS + 1;
    const blocks = section(
      'BLOCKS',
      [
        tags([0, 'BLOCK'], [2, 'UNIT'], [10, '0'], [20, '0']),
        tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '1'], [21, '0']),
        tags([0, 'ENDBLK']),
      ].join('\n'),
    );
    const entities = section(
      'ENTITIES',
      tags(
        [0, 'INSERT'],
        [2, 'UNIT'],
        [70, String(columns)],
        [71, String(GRID_ROWS)],
        [44, '2'],
        [45, '2'],
      ),
    );
    const result = parseDxf({
      dxfText: `${blocks}\n${entities}\n${tags([0, 'EOF'])}\n`,
      id: 'test-id',
      source: 'oversized-minsert.dxf',
    });
    expect(result).toMatchObject({ kind: 'ok', object: null });
    if (result.kind === 'ok') {
      expect(result.notes).toContain(
        `INSERT "UNIT" skipped: MINSERT grid has ${columns * GRID_ROWS} instances (maximum ${MAX_MINSERT_INSTANCES})`,
      );
    }
  });
});
