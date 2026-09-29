import { describe, expect, it } from 'vitest';
import { importLightBurnProject } from './lbrn-import';

// The import report names every LightBurn cut setting a layer opened without,
// and only those that change the cut (ADR-388).

function warnings(type: string, fields: string): ReadonlyArray<string> {
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
      <CutSetting type="${type}"><index Value="0"/><name Value="Tag"/>${fields}</CutSetting>
      <Shape Type="Rect" CutIndex="0" W="40" H="20"><XForm>1 0 0 1 100 100</XForm></Shape>
    </LightBurnProject>`,
    'tag.lbrn2',
  );
  if (!result.ok) throw new Error(result.reason);
  return result.report.warnings;
}

const values = (fields: Record<string, string | number>) =>
  Object.entries(fields)
    .map(([name, value]) => `<${name} Value="${value}"/>`)
    .join('');

// Every field a LightBurn 0.9 project writes on a Cut layer, each at the value
// LightBurn writes when the setting is not in use.
const IDLE_CUT_LAYER = {
  maxPower: 60,
  minPower: 60,
  speed: 10,
  numPasses: 1,
  priority: 0,
  runBlower: 1,
  doOutput: 1,
  hide: 0,
  kerf: 0,
  PPI: 200,
  enablePPI: 0,
  angle: 0,
  bidir: 1,
  crossHatch: 0,
  interval: 0.1,
  overscan: 1,
  overscanPercent: 2.5,
  scanOpt: 'mergeAll',
  floodFill: 0,
  autoBlower: 0,
  blowerSpeedOverride: 0,
  blowerSpeedPercent: 100,
  cellsPerInch: 50,
  halftoneAngle: 22.5,
  dotMode: 0,
  dotTime: 1,
  dotSpacing: 0.1,
  enableCutThroughStart: 0,
  enableCutThroughEnd: 0,
  throughPower: 0,
  throughPower2: 0,
  enableLaser1: 1,
  enableLaser2: 0,
  minPower2: 20,
  maxPower2: 20,
  startDelay: 0,
  endDelay: 0,
  forceConstantPower: 0,
  frequency: 20000,
  overrideFrequency: 0,
  manualTabs: 1,
  tabsEnabled: 0,
  tabCount: 1,
  tabCountMax: 1,
  tabSize: 0.5,
  tabSpacing: 50,
  tabsUseSpacing: 1,
  skipInnerTabs: 0,
  tabCutPower: 0,
  overcut: 0,
  perforate: 0,
  perfLen: 0.1,
  perfSkip: 0.1,
  rampLength: 0,
  rampOuter: 0,
  zOffset: 0,
  zPerPass: 0,
};

describe('LightBurn settings named in the import report', () => {
  it('names each setting a Cut layer uses that did not come across', () => {
    expect(
      warnings(
        'Cut',
        values({
          ...IDLE_CUT_LAYER,
          perforate: 1,
          perfLen: 2,
          perfSkip: 0.5,
          tabsEnabled: 1,
          tabCount: 4,
          overcut: 1.5,
          zPerPass: 0.4,
          minPower: 20,
        }),
      ),
    ).toEqual([
      'Tag: LightBurn Min Power was not imported (minPower 20); KerfDesk gives the operation one power, its Max Power.',
      'Tag: LightBurn Overcut was not imported (overcut 1.5).',
      'Tag: LightBurn Perforation Mode was not imported (perforate 1, perfLen 2, perfSkip 0.5).',
      'Tag: LightBurn Tabs was not imported (tabsEnabled 1, tabSize 0.5, tabCount 4, tabCountMax 1, tabSpacing 50, tabsUseSpacing 1, skipInnerTabs 0, tabCutPower 0, manualTabs 1).',
      'Tag: LightBurn Z Step Per Pass was not imported (zPerPass 0.4).',
    ]);
  });

  it('leaves out every setting LightBurn itself is not using', () => {
    expect(warnings('Cut', values(IDLE_CUT_LAYER))).toEqual([]);
    // As LightBurn 2.0.05 writes a layer (the external corpus), on a Fill.
    const written = values({ minPower: 50, maxPower: 50, minPower2: 10, maxPower2: 20 });
    const idle = values({ PPI: 0, dotTime: 1, dotSpacing: 0.01, tabCount: 1, tabCountMax: 1 });
    expect(warnings('Scan', written + idle)).toEqual([]);
  });

  it('names Fill settings on a Fill only', () => {
    const fill = values({ kerf: 0.1, floodFill: 1, scanOpt: 'individual' });
    expect(warnings('Scan', fill)).toEqual([
      'Tag: LightBurn Fill Grouping was not imported (scanOpt individual).',
      'Tag: LightBurn Flood Fill was not imported (floodFill 1).',
      'Tag: LightBurn Kerf Offset was not imported (kerf 0.1); KerfDesk offsets Line operations only.',
    ]);
    expect(warnings('Scan+Cut', fill)).toHaveLength(2);
    expect(warnings('Cut', fill)).toEqual([]);
  });

  it('names once a setting both operations of a Fill+Line layer open without', () => {
    expect(warnings('Scan+Cut', values({ dotMode: 1, dotTime: 2 }))).toEqual([
      'Tag: LightBurn Dot Mode was not imported (dotMode 1, dotTime 2).',
    ]);
  });

  it('names a setting it does not know, and a block of settings, whenever they are set', () => {
    expect(
      warnings(
        'Cut',
        values({ futureSetting: 3, futureSwitch: 0, enableLaser1: 0 }) +
          '<SubLayer><index Value="1"/></SubLayer>',
      ),
    ).toEqual([
      'Tag: LightBurn setting “enableLaser1” was not imported (0).',
      'Tag: LightBurn setting “futureSetting” was not imported (3).',
      'Tag: LightBurn “SubLayer” settings were not imported.',
    ]);
  });
});
