import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, resolveGrblDialect } from '../devices';
import type { CutGroup } from '../job';
import { generateFocusTest } from '../job/focus-test';
import { createProject } from '../scene';
import { grblStrategy, hasRepresentedCutBurn } from './grbl-strategy';
import { compiledFocusTestWarnings } from '../../ui/laser/job-review/focus-test-warnings';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';

function focus(power: number): CutGroup {
  return {
    kind: 'cut',
    layerId: 'focus',
    color: '#000000',
    power,
    speed: 1200,
    passes: 1,
    airAssist: false,
    focusTest: { offsetMm: 1, travelFeedMmPerMin: 300 },
    segments: [
      {
        closed: false,
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      },
    ],
  };
}

describe('Focus requires represented positive laser power', () => {
  it.each([
    { power: 0, maxPowerS: 1000, version: 2 as const },
    { power: 10, maxPowerS: 1, version: 2 as const },
    { power: 10, maxPowerS: 0.5, version: 1 as const },
  ])('omits Z for emitted S0: %j', ({ power, maxPowerS, version }) => {
    const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS };
    const group = focus(power);
    const context = {
      device,
      dialect: resolveGrblDialect(device),
      arcMovesEnabled: true,
      laserPowerScaleVersion: version,
    };
    expect(hasRepresentedCutBurn(group, context)).toBe(false);
    const output = grblStrategy.emit({ groups: [group] }, device, {
      laserPowerScaleVersion: version,
    });
    expect(output).not.toContain('G1 Z');
    expect(output).not.toContain('Focus Test Z offset');
  });
  it('retains fractional positive S in current output while legacy scaling rounds it to zero', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 0.5 };
    const output = grblStrategy.emit({ groups: [focus(10)] }, device, {
      laserPowerScaleVersion: 2,
    });
    expect(output).toContain('S0.05');
    expect(output.match(/G1 Z/g)).toHaveLength(2);
  });
  it('keeps neighboring ordinary zero-power XY output byte-for-byte', () => {
    const { focusTest: _focus, ...ordinary } = focus(0);
    const job = { groups: [{ ...ordinary, layerId: 'ordinary' }] };
    const expected = grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(expected).toContain('G1 X30.000 Y10.000');
    expect(grblStrategy.emit({ groups: [focus(0), ...job.groups] }, DEFAULT_DEVICE_PROFILE)).toBe(
      expected,
    );
  });
  it('does not claim Focus Z motion in review when effective power is zero', () => {
    expect(
      compiledFocusTestWarnings({ project: createProject(), job: { groups: [focus(0)] } }),
    ).toEqual([]);
  });
  it('respects object power multiplier zero after real output preparation', () => {
    const scene = generateFocusTest({
      steps: 3,
      minOffsetMm: -1,
      maxOffsetMm: 1,
      lineLengthMm: 20,
      spacingMm: 3,
      speed: 1200,
      power: 10,
      travelFeedMmPerMin: 300,
    });
    const project = {
      ...createProject(),
      scene: { ...scene, objects: scene.objects.map((object) => ({ ...object, powerScale: 0 })) },
    };
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('Fixture must compile');
    expect(prepared.job.groups.every((group) => group.kind === 'cut' && group.power === 0)).toBe(
      true,
    );
    expect(emitPreparedGcode(prepared).gcode).not.toContain('G1 Z');
    expect(compiledFocusTestWarnings(prepared)).toEqual([]);
  });
});
