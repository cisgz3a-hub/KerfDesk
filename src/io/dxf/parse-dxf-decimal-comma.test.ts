import { describe, expect, it } from 'vitest';
import { parseDxf, type ParseDxfResult } from './parse-dxf';

// Oracle audit O8-P2-2 (ADR-357 Amendment 6): parseFloat read a comma-locale
// "12,5" as 12 and a Windows "1.#QNAN" as 1, importing the part about 4 % small
// with no note. ezdxf refuses such a value; KerfDesk now skips and reports the
// entity, as it already did for a non-numeric value (IMP-08).

function tags(...pairs: ReadonlyArray<readonly [number, string]>): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n');
}

function parseEntities(...entities: ReadonlyArray<string>): ParseDxfResult {
  const text = [
    tags([0, 'SECTION'], [2, 'ENTITIES']),
    ...entities,
    tags([0, 'ENDSEC']),
    tags([0, 'EOF']),
  ].join('\n');
  return parseDxf({ dxfText: `${text}\n`, id: 'test-id', source: 'test.dxf' });
}

describe('parseDxf reads each real whole', () => {
  it('skips a decimal-comma or NaN-spelled coordinate instead of truncating it', () => {
    const result = parseEntities(
      tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '10'], [21, '0']), // valid
      tags([0, 'LINE'], [10, '0'], [20, '0'], [11, '12,5'], [21, '7,25']),
      tags([0, 'CIRCLE'], [10, '0'], [20, '0'], [40, '2,5']),
      tags([0, 'LINE'], [10, '1.#QNAN'], [20, '0'], [11, '5'], [21, '5']),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.pathCount).toBe(1);
    expect(result.skippedSummary).toContain('2 LINE');
    expect(result.skippedSummary).toContain('1 CIRCLE');
  });

  it('still reads every legal real spelling (regression: normal files unaffected)', () => {
    const result = parseEntities(
      tags([0, 'LINE'], [10, ' -.5'], [20, '+0'], [11, '1.0E+01'], [21, '5.']),
    );
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.pathCount).toBe(1);
    expect(result.skippedSummary).toBeNull();
  });
});
