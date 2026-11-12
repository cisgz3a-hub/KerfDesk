import { describe, expect, it } from 'vitest';
import { deserializeMaterialLibrary, serializeMaterialLibrary } from '../material-library';
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

  it('keeps any-thickness entries as titled presets so the library reopens', () => {
    // LightBurn writes Thickness="-1" (or 0) plus NoThickTitle for entries that
    // apply to any thickness; the saved library needs a positive thickness or a title.
    const result = importLightBurnClb(
      `<LightBurnLibrary><Material Name="Slate"><Entry Thickness="-1.0000" Desc="Light" NoThickTitle="Engrave"><CutSetting Type="Scan" Speed="200" MaxPower="30" /></Entry><Entry Thickness="0.0000" Desc="Mark"><CutSetting Type="Cut" Speed="20" MaxPower="10" /></Entry><Entry Thickness="3.0000" Desc="Cut"><CutSetting Type="Cut" Speed="8" MaxPower="75" /></Entry></Material></LightBurnLibrary>`,
      'slate.clb',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [anyThickness, zeroThickness, sized] = result.library.entries;
    expect(anyThickness).toMatchObject({ title: 'Engrave: Light' });
    expect(anyThickness).not.toHaveProperty('thicknessMm');
    expect(zeroThickness).toMatchObject({ title: 'Mark' });
    expect(zeroThickness).not.toHaveProperty('thicknessMm');
    expect(sized).toMatchObject({ thicknessMm: 3, description: 'Cut (imported from slate.clb)' });
    expect(sized).not.toHaveProperty('title');

    const reopened = deserializeMaterialLibrary(serializeMaterialLibrary(result.library));
    expect(reopened).toMatchObject({ kind: 'ok' });
  });

  it('converts the LightBurn overscan percentage instead of reading the on/off switch as mm', () => {
    // LightBurn: overscan is a percentage of cut speed (2.5% at 100 mm/s = 2.5 mm).
    const enabled = importLightBurnClb(
      `<LightBurnLibrary><Material Name="Oak"><Entry Thickness="3" Desc="Fill"><CutSetting type="Scan"><speed Value="300"/><maxPower Value="20"/><overscan Value="1"/><overscanPercent Value="2.5"/></CutSetting></Entry></Material></LightBurnLibrary>`,
      'oak.clb',
    );
    expect(enabled.ok && enabled.library.entries[0]?.recipe.fillOverscanMm).toBe(7.5);
    expect(enabled.ok && enabled.report.unknownFields).not.toContain('overscanPercent');
    expect(enabled.ok && enabled.report.warnings.join(' ')).toContain('7.5 mm');

    const disabled = importLightBurnClb(
      `<LightBurnLibrary><Material Name="Oak"><Entry Thickness="3" Desc="Fill"><CutSetting type="Scan"><speed Value="300"/><maxPower Value="20"/><overscan Value="0"/><overscanPercent Value="2.5"/></CutSetting></Entry></Material></LightBurnLibrary>`,
      'oak.clb',
    );
    expect(disabled.ok && disabled.library.entries[0]?.recipe.fillOverscanMm).toBe(0);
  });

  it.each([null, '-1', 'not-a-number'])(
    'reports the actual zero runway when an enabled overscan percentage is unresolved (%s)',
    (percent) => {
      const percentField = percent === null ? '' : `<overscanPercent Value="${percent}"/>`;
      const result = importLightBurnClb(
        `<LightBurnLibrary><Material Name="Oak"><Entry Thickness="3" Desc="Fill"><CutSetting type="Scan"><speed Value="300"/><maxPower Value="20"/><overscan Value="1"/>${percentField}</CutSetting></Entry></Material></LightBurnLibrary>`,
        'unresolved-overscan.clb',
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.library.entries[0]?.recipe.fillOverscanMm).toBe(0);
      expect(result.report.warnings).toEqual([
        'Fill: LightBurn Scan overscan could not be converted without a nonnegative imported percentage; review the default 0 mm runway.',
      ]);
    },
  );

  it('reads air assist from the runBlower field LightBurn writes', () => {
    // LightBurn writes a cut setting's Air Assist as <runBlower Value="0|1"/>, in
    // libraries as in projects.
    for (const [value, airAssist] of [
      ['1', true],
      ['0', false],
    ] as const) {
      const result = importLightBurnClb(
        `<LightBurnLibrary><Material name="Birch"><Entry Thickness="3.0000" Desc="Cut"><CutSetting type="Cut"><maxPower Value="75"/><speed Value="8"/><runBlower Value="${value}"/></CutSetting></Entry></Material></LightBurnLibrary>`,
        'birch.clb',
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.library.entries[0]?.recipe.airAssist).toBe(airAssist);
      expect(result.report.unknownFields).not.toContain('runBlower');
    }
  });

  it('opens a Fill+Line (Scan+Cut) entry as a Fill preset and a Line preset, and says so', () => {
    // Audit 21-P2-3. The entry's shape follows Binary-Kitchen/thunderlaser_nova35
    // material_library.clb, whose "Füllen + Cut" entries are of this type.
    const result = importLightBurnClb(
      `<?xml version="1.0" encoding="UTF-8"?><LightBurnLibrary DisplayName="Shop">
        <Material name="Plywood">
          <Entry Thickness="3.0000" Desc="Engrave and outline">
            <CutSetting type="Scan+Cut"><index Value="0"/><name Value="C00"/>
              <maxPower Value="60"/><speed Value="10"/><interval Value="0.1"/><overscan Value="0"/>
            </CutSetting>
          </Entry>
        </Material></LightBurnLibrary>`,
      'shop.clb',
    );
    if (!result.ok) throw new Error(result.reason);
    expect(
      result.library.entries.map(({ id, operation, thicknessMm, description, recipe }) => ({
        id,
        operation,
        thicknessMm,
        description,
        mode: recipe.mode,
        power: recipe.power,
        speed: recipe.speed,
      })),
    ).toEqual([
      {
        id: 'plywood-engrave-and-outline-1',
        operation: 'engrave',
        thicknessMm: 3,
        description: 'Engrave and outline (imported from shop.clb)',
        mode: 'fill',
        power: 60,
        speed: 600,
      },
      {
        id: 'plywood-engrave-and-outline-1-line',
        operation: 'cut',
        thicknessMm: 3,
        description: 'Engrave and outline (Line) (imported from shop.clb)',
        mode: 'line',
        power: 60,
        speed: 600,
      },
    ]);
    expect(result.report.importedEntries).toBe(2);
    expect(result.report.warnings).toEqual([
      'Entry 1 (Plywood, “Engrave and outline”) is a LightBurn Fill+Line setting, so it opened as a Fill preset and a Line preset, “Engrave and outline (Line)”. Apply the Line to a second operation that runs after the Fill to cut the outlines.',
    ]);
    expect(deserializeMaterialLibrary(serializeMaterialLibrary(result.library))).toMatchObject({
      kind: 'ok',
    });
  });

  it('reads the mode as a whole name, and names one it does not know', () => {
    const mode = (type: string) => {
      const typeAttribute = type === '' ? '' : ` type="${type}"`;
      const result = importLightBurnClb(
        `<LightBurnLibrary><Material name="Oak"><Entry Thickness="3" Desc="Mark"><CutSetting${typeAttribute}><maxPower Value="20"/><speed Value="100"/></CutSetting></Entry></Material></LightBurnLibrary>`,
        'oak.clb',
      );
      if (!result.ok) throw new Error(result.reason);
      return {
        modes: result.library.entries.map((entry) => entry.recipe.mode),
        warnings: result.report.warnings,
      };
    };
    expect(mode('Cut')).toEqual({ modes: ['line'], warnings: [] });
    expect(mode('Scan')).toEqual({ modes: ['fill'], warnings: [] });
    expect(mode('Image')).toEqual({ modes: ['image'], warnings: [] });
    expect(mode('')).toEqual({ modes: ['line'], warnings: [] });
    expect(mode('Offset Fill')).toEqual({
      modes: ['fill'],
      warnings: [
        'Entry 1 (Oak, “Mark”): LightBurn mode “Offset Fill” has no KerfDesk equivalent, so it opened as a Fill preset. Check its settings before using it.',
      ],
    });
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

  // O9-P3-2: the .lbrn importer rounds a pass count, so the .clb one does too.
  it('rounds a fractional pass count as a LightBurn project import does', () => {
    const passes = (value: string): number | undefined => {
      const result = importLightBurnClb(
        `<LightBurnLibrary><Material name="Oak"><Entry Thickness="3" Desc="Cut"><CutSetting type="Cut"><maxPower Value="50"/><speed Value="10"/><numPasses Value="${value}"/></CutSetting></Entry></Material></LightBurnLibrary>`,
        'passes.clb',
      );
      return result.ok ? result.library.entries[0]?.recipe.passes : undefined;
    };
    expect(passes('2.7')).toBe(3);
    expect(passes('2.2')).toBe(2);
    expect(passes('0.4')).toBe(1);
  });
});
