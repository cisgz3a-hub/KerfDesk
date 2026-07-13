import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importLightBurnClb } from './clb-import';

const FIXTURE_ROOT = resolve(process.cwd(), 'src/__fixtures__/lightburn/external/clb');

const IMPORTABLE_FIXTURES = [
  { sourceName: 'ddlab-laser-settings-current.clb', entries: 35, unknownField: 'LinkPath' },
  { sourceName: 'ddlab-laser-settings-legacy.clb', entries: 19, unknownField: 'LinkPath' },
  { sourceName: 'h3mul-main-material-library.clb', entries: 11, unknownField: 'LinkPath' },
  { sourceName: 'jayson-big-blue-laser.clb', entries: 13, unknownField: 'kerf' },
] as const;

describe('external LightBurn CLB compatibility corpus', () => {
  it.each(IMPORTABLE_FIXTURES)(
    'imports $sourceName deterministically without skipping entries',
    ({ sourceName, entries, unknownField }) => {
      const xml = fixture(sourceName);
      const first = importLightBurnClb(xml, sourceName);
      const second = importLightBurnClb(xml, sourceName);

      expect(first).toEqual(second);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.library.entries).toHaveLength(entries);
      expect(first.report.importedEntries).toBe(entries);
      expect(first.report.warnings).toEqual([]);
      expect(first.report.unknownFields).toContain(unknownField);
      expect(first.report.unknownFields).toEqual([...first.report.unknownFields].sort());
    },
  );

  it('reads the Value attributes used by real LightBurn cut settings', () => {
    const result = importLightBurnClb(
      fixture('jayson-big-blue-laser.clb'),
      'jayson-big-blue-laser.clb',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.entries[0]).toMatchObject({
      materialName: 'Acrylic Sheet',
      thicknessMm: 5,
      recipe: { mode: 'line', speed: 480, power: 80 },
    });
  });

  it('rejects a genuine empty LightBurn library explicitly', () => {
    expect(importLightBurnClb(fixture('jayson-tmx90-empty.clb'), 'jayson-tmx90-empty.clb')).toEqual(
      { ok: false, reason: 'CLB contains no material entries.' },
    );
  });
});

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf8');
}
