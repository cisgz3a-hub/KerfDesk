import { describe, expect, it } from 'vitest';
import { importLightBurnClb } from './clb-import';

const FIXTURES = [
  `<LightBurnLibrary><Material Name="Birch"><Entry Thickness="3" Desc="Clean cut"><CutSetting Type="Cut" Speed="8" MaxPower="75" MinPower="5" NumPasses="2" AirAssist="1" /></Entry></Material></LightBurnLibrary>`,
  `<Library><Material Name="Acrylic"><Entry Thickness="5" Desc="Fill"><CutSetting><Type>Scan</Type><Speed>120</Speed><MaxPower>20</MaxPower><Interval>0.08</Interval></CutSetting></Entry></Material></Library>`,
  `<Library><Material Name="Card"><Entry Desc="Score"><CutSetting_0 speed="40" power="15" passes="1" /></Entry></Material></Library>`,
  `<Library><Material Name="Photo"><Entry Desc="Image"><CutSettings Type="Image" Speed="150" MaxPower="30" NegativeImage="true" /></Entry></Material></Library>`,
  `<Library><Material Name="MDF"><Entry Thickness="6" Desc="Cut"><CutSetting CutMode="Line" SpeedMmSec="5" MaxPower="90" PassCount="4" UnknownPulse="12" /></Entry></Material></Library>`,
] as const;

describe('LightBurn CLB import', () => {
  it('imports a five-shape compatibility corpus deterministically', () => {
    const results = FIXTURES.map((fixture, index) =>
      importLightBurnClb(fixture, `fixture-${index}.clb`),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const first = results[0];
    if (first === undefined || !first.ok) throw new Error('first fixture did not import');
    expect(first.library.entries[0]).toMatchObject({
      materialName: 'Birch',
      thicknessMm: 3,
      recipe: { mode: 'line', speed: 480, power: 75, minPower: 5, passes: 2, airAssist: true },
    });
    const fifth = results[4];
    if (fifth === undefined || !fifth.ok) throw new Error('fifth fixture did not import');
    expect(fifth.report.unknownFields).toContain('UnknownPulse');
  });

  it('converts documented CLB mm/s speed into internal mm/min', () => {
    const result = importLightBurnClb(FIXTURES[1], 'acrylic.clb');
    expect(result.ok && result.library.entries[0]?.recipe.speed).toBe(7200);
    expect(result.ok && result.library.entries[0]?.recipe.hatchSpacingMm).toBe(0.08);
  });

  it('rejects DTDs, entities, malformed XML, empty libraries, and oversized input', () => {
    expect(importLightBurnClb('<!DOCTYPE x><Library/>', 'active.clb')).toMatchObject({ ok: false });
    expect(importLightBurnClb('<!ENTITY x "y"><Library/>', 'entity.clb')).toMatchObject({
      ok: false,
    });
    expect(importLightBurnClb('<Library>', 'broken.clb')).toMatchObject({ ok: false });
    expect(importLightBurnClb('<Library/>', 'empty.clb')).toMatchObject({ ok: false });
    expect(importLightBurnClb(' '.repeat(5_000_001), 'huge.clb')).toMatchObject({ ok: false });
  });

  it('reports skipped unsupported entries instead of silently inventing settings', () => {
    const result = importLightBurnClb(
      `<Library><Material Name="Mixed"><Entry Desc="Missing"><CutSetting Speed="10" /></Entry><Entry Desc="Good"><CutSetting Speed="10" MaxPower="20" /></Entry></Material></Library>`,
      'mixed.clb',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.entries).toHaveLength(1);
    expect(result.report.warnings).toEqual([
      'Entry 1 was skipped because speed or power was missing.',
    ]);
  });
});
