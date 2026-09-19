import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import { LINE_CATEGORY, SEG_KIND } from './render-model-types';

describe('native laser render words', () => {
  it('keeps Smoothie percent override separate from sticky fractional motion S', () => {
    const result = buildGcodeRenderModel(
      [
        'fire off',
        'G21 G90',
        'M221 S100 P0',
        'G1 X1 S0.25 F600',
        'M400',
        'M221 S50 R10000',
        'G1 X2',
        'M221 S0',
        'G1 X3 S0.5',
        'M221 S100 P1',
        'G1 X4',
      ].join('\n'),
      { machineKind: 'laser', laserPowerControl: 'smoothieware' },
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.unsupportedWords).toEqual([]);
    expect([...result.model.lineCategories]).not.toContain(LINE_CATEGORY.junk);
    expect([...result.model.segPower]).toEqual([0.25, 0.125, 0, 0.5]);
    expect([...result.model.segKind]).toEqual([
      SEG_KIND.cut,
      SEG_KIND.cut,
      SEG_KIND.travel,
      SEG_KIND.cut,
    ]);
    expect(result.model.stats.powerMax).toBe(0.5);
    expect(result.model.events.filter((event) => event.kind === 'spindle-on')).toMatchObject([
      { mode: 'dynamic', power: 0 },
      { mode: 'dynamic', power: 0.125 },
      { mode: 'constant', power: 0.5 },
    ]);
    expect(result.model.events.filter((event) => event.kind === 'synchronization')).toEqual([
      { kind: 'synchronization', code: 'M400', isBeforeMotion: false, line: 4 },
    ]);
  });

  it.each([undefined, 'cnc'] as const)(
    'does not infer native Smoothie laser semantics for a %s program',
    (machineKind) => {
      const result = buildGcodeRenderModel('fire off\nM221 S100\nG1 X1 F600 S0.25', {
        machineKind,
        laserPowerControl: 'smoothieware',
      });
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.model.unsupportedWords).toMatchObject([{ word: 'M221' }]);
      expect(result.model.lineCategories[0]).toBe(LINE_CATEGORY.junk);
      expect(result.model.segKind[0]).toBe(SEG_KIND.cut);
    },
  );

  it.each(['M3 Ijunk S0', 'M5 I garbage', 'G1 X10junk', 'G1 I X10'])(
    'keeps malformed external syntax diagnostic: %s',
    (line) => {
      const result = buildGcodeRenderModel(`G21\n${line}\nG1 X1 F600`);
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') expect(result.model.lineCategories[1]).toBe(LINE_CATEGORY.junk);
    },
  );
});
