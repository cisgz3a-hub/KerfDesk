// The operator's power-scale statement (annoyance audit A2 B3-P2-1, ADR-095
// Amendment 1): who may make one, what it stands for, and what voids it.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { deviceProfileWithInteractivePatch } from './device-profile-patch';
import {
  createOperatorPowerScaleStatement,
  isOperatorPowerScaleStatement,
  operatorPowerScaleStatementEntry,
  operatorStatedPowerScaleFact,
  standingPowerScaleStatement,
  unreportedPowerScaleStartPrompt,
  unreportedPowerScaleWarning,
} from './power-scale-statement';

const STATED_AT = '2026-11-11T10:00:00.000Z';

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  streamingMode: 'ping-pong',
  maxPowerS: 255,
};

const SMOOTHIE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

function stated(device: DeviceProfile): DeviceProfile {
  const statement = createOperatorPowerScaleStatement(device, STATED_AT);
  if (statement === null) throw new Error('fixture: this firmware takes a statement');
  return { ...device, operatorPowerScaleStatement: statement };
}

describe('who can state a power scale', () => {
  it.each([MARLIN, SMOOTHIE])('a $controllerKind profile can', (device) => {
    expect(createOperatorPowerScaleStatement(device, STATED_AT)).toEqual({
      maxPowerS: device.maxPowerS,
      controllerKind: device.controllerKind,
      dialectId: device.gcodeDialect.dialectId,
      statedAtIso: STATED_AT,
    });
  });

  it.each(['grbl-v1.1', 'grblhal', 'fluidnc', 'ruida', 'moshi', undefined] as const)(
    'a %s profile cannot: its report, or another path, is the evidence',
    (controllerKind) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind };
      expect(createOperatorPowerScaleStatement(device, STATED_AT)).toBeNull();
    },
  );
});

describe('what a statement stands for', () => {
  it('stands while the profile is the one it was made for', () => {
    expect(standingPowerScaleStatement(stated(MARLIN))?.maxPowerS).toBe(255);
    expect(standingPowerScaleStatement(MARLIN)).toBeNull();
  });

  it.each<[string, Partial<DeviceProfile>]>([
    ['Full-power S', { maxPowerS: 100 }],
    ['the controller family', { controllerKind: 'smoothieware' }],
    ['a family that reports its scale', { controllerKind: 'grbl-v1.1' }],
    ['the output dialect', { gcodeDialect: { dialectId: 'marlin-fan' } }],
  ])('does not stand once %s differs, even in a hand-edited file', (_label, change) => {
    expect(standingPowerScaleStatement({ ...stated(MARLIN), ...change })).toBeNull();
  });

  it('is removed by an edit to what it describes, and does not come back', () => {
    const edited = deviceProfileWithInteractivePatch(stated(MARLIN), { maxPowerS: 100 });
    expect(edited.operatorPowerScaleStatement).toBeUndefined();
    const restored = deviceProfileWithInteractivePatch(edited, { maxPowerS: 255 });
    expect(restored.operatorPowerScaleStatement).toBeUndefined();
    expect(standingPowerScaleStatement(restored)).toBeNull();
  });

  it.each<[string, Partial<DeviceProfile>]>([
    ['the controller', { controllerKind: 'smoothieware' }],
    ['the output dialect', { gcodeDialect: { dialectId: 'marlin-fan' } }],
  ])('is removed by a change of %s', (_label, patch) => {
    const edited = deviceProfileWithInteractivePatch(stated(MARLIN), patch);
    expect(edited.operatorPowerScaleStatement).toBeUndefined();
  });

  it('survives an edit to anything else, and a new statement in the same edit', () => {
    const feed = deviceProfileWithInteractivePatch(stated(MARLIN), { maxFeed: 3000 });
    expect(feed.operatorPowerScaleStatement).toEqual(stated(MARLIN).operatorPowerScaleStatement);
    const restated = createOperatorPowerScaleStatement({ ...MARLIN, maxPowerS: 100 }, STATED_AT);
    const both = deviceProfileWithInteractivePatch(stated(MARLIN), {
      maxPowerS: 100,
      operatorPowerScaleStatement: restated ?? undefined,
    });
    expect(standingPowerScaleStatement(both)?.maxPowerS).toBe(100);
  });
});

describe('a statement read from a file', () => {
  it('is kept only when it is well formed', () => {
    const good = stated(MARLIN).operatorPowerScaleStatement;
    expect(operatorPowerScaleStatementEntry(good)).toEqual({ operatorPowerScaleStatement: good });
    for (const bad of [
      null,
      true,
      'yes',
      { ...good, maxPowerS: 0 },
      { ...good, maxPowerS: Number.NaN },
      { ...good, controllerKind: 'grbl-v1.1' },
      { ...good, dialectId: '' },
      { ...good, statedAtIso: 'yesterday' },
    ]) {
      expect(isOperatorPowerScaleStatement(bad)).toBe(false);
      expect(operatorPowerScaleStatementEntry(bad)).toEqual({});
    }
  });
});

describe('the wording', () => {
  it('names the firmware and what to check, with no GRBL setting numbers', () => {
    const texts = [
      unreportedPowerScaleWarning(MARLIN),
      unreportedPowerScaleStartPrompt(MARLIN),
      unreportedPowerScaleWarning(SMOOTHIE),
      unreportedPowerScaleStartPrompt(SMOOTHIE),
      unreportedPowerScaleWarning({ ...MARLIN, gcodeDialect: { dialectId: 'marlin-fan' } }),
    ];
    for (const text of texts) expect(text).not.toMatch(/\$3[0-2]|GRBL/);
    expect(texts[0]).toContain('Marlin does not report its laser power scale');
    expect(texts[0]).toContain('CUTTER_POWER_UNIT');
    expect(texts[0]).toContain('S255');
    expect(texts[2]).toContain('laser_module_maximum_s_value');
    expect(texts[4]).toContain('M106');
    expect(texts[1]).toMatch(/Start this laser job anyway\?$/);
  });

  it('labels the fact line as operator-stated and never calls it checked', () => {
    const statement = stated(MARLIN).operatorPowerScaleStatement;
    if (statement === undefined) throw new Error('fixture');
    const fact = operatorStatedPowerScaleFact(statement);
    expect(fact).toContain('operator-stated');
    expect(fact).toContain('You recorded on 2026-11-11');
    expect(fact).toContain('KerfDesk has not checked it');
    expect(fact).not.toMatch(/verified/i);
  });
});
