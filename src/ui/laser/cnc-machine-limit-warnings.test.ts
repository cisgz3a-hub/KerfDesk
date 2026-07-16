import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncStock,
  type Layer,
  type Project,
} from '../../core/scene';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { detectCncMachineLimitWarnings } from './cnc-machine-limit-warnings';

// Default CNC stock is 400 × 400 mm; the default layer feed is 1000 mm/min,
// plunge 300 mm/min, spindle 12000 RPM.
function cncProject(args: {
  readonly stock?: Partial<CncStock>;
  readonly feedMmPerMin?: number;
  readonly plungeMmPerMin?: number;
  readonly spindleRpm?: number;
  readonly output?: boolean;
}): Project {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    ...(args.output === undefined ? {} : { output: args.output }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      ...(args.feedMmPerMin === undefined ? {} : { feedMmPerMin: args.feedMmPerMin }),
      ...(args.plungeMmPerMin === undefined ? {} : { plungeMmPerMin: args.plungeMmPerMin }),
      ...(args.spindleRpm === undefined ? {} : { spindleRpm: args.spindleRpm }),
    },
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, ...args.stock },
    },
    scene: { objects: [], layers: [layer] },
  };
}

describe('detectCncMachineLimitWarnings (ADR-111)', () => {
  it('is silent when no controller is connected (limits null)', () => {
    expect(detectCncMachineLimitWarnings(cncProject({ stock: { widthMm: 900 } }), null)).toEqual(
      [],
    );
  });

  it('is silent for a laser project even with limits present', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 100, bedHeight: 100, maxFeed: 1 };
    expect(detectCncMachineLimitWarnings(createProject(), limits)).toEqual([]);
  });

  it('is silent when the job sits inside the reported limits', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400, maxFeed: 1500 };
    expect(detectCncMachineLimitWarnings(cncProject({}), limits)).toEqual([]);
  });

  it('warns when stock is wider than the reported travel', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ stock: { widthMm: 500 } }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('width 500 mm > 400 mm');
    expect(warning).toContain('reported travel');
  });

  it('names only the axis that overhangs (height)', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    const [warning] = detectCncMachineLimitWarnings(
      cncProject({ stock: { heightMm: 450 } }),
      limits,
    );
    expect(warning).toContain('height 450 mm > 400 mm');
    expect(warning).not.toContain('width');
  });

  it('warns when a layer feed exceeds the reported max rate', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 800 };
    const [warning] = detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 1200 }), limits);
    expect(warning).toContain('1200 mm/min');
    expect(warning).toContain('800 mm/min');
  });

  it('ignores feed on layers that do not output', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 800 };
    const project = cncProject({ feedMmPerMin: 5000, output: false });
    expect(detectCncMachineLimitWarnings(project, limits)).toEqual([]);
  });

  it('cannot warn about feed when the snapshot has no max rate', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 400, bedHeight: 400 };
    expect(detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 9000 }), limits)).toEqual([]);
  });

  it('warns against the SLOWER reported axis rate on an asymmetric machine', () => {
    const limits: ControllerSettingsSnapshot = {
      maxFeed: 10000,
      maxFeedX: 10000,
      maxFeedY: 6000,
    };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ feedMmPerMin: 8000 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('8000 mm/min');
    expect(warning).toContain('6000 mm/min');
  });

  it('is silent when the feed fits under the slower reported axis rate', () => {
    const limits: ControllerSettingsSnapshot = {
      maxFeed: 10000,
      maxFeedX: 10000,
      maxFeedY: 6000,
    };
    expect(detectCncMachineLimitWarnings(cncProject({ feedMmPerMin: 6000 }), limits)).toEqual([]);
  });

  it('warns when a layer plunge exceeds the reported Z max rate ($112)', () => {
    const limits: ControllerSettingsSnapshot = { zMaxFeed: 200 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ plungeMmPerMin: 300 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('plunge 300 mm/min');
    expect(warning).toContain('200 mm/min');
  });

  it('is silent about plunge when the snapshot has no Z max rate', () => {
    const limits: ControllerSettingsSnapshot = { maxFeed: 5000 };
    expect(detectCncMachineLimitWarnings(cncProject({ plungeMmPerMin: 9000 }), limits)).toEqual([]);
  });

  it('warns when a layer spindle RPM exceeds the reported $30 max', () => {
    const limits: ControllerSettingsSnapshot = { maxPowerS: 10000 };
    const [warning, ...rest] = detectCncMachineLimitWarnings(
      cncProject({ spindleRpm: 12000 }),
      limits,
    );
    expect(rest).toEqual([]);
    expect(warning).toContain('12000 RPM');
    expect(warning).toContain('10000 RPM');
  });

  it('is silent when the spindle RPM equals the reported $30 max', () => {
    const limits: ControllerSettingsSnapshot = { maxPowerS: 12000 };
    expect(detectCncMachineLimitWarnings(cncProject({ spindleRpm: 12000 }), limits)).toEqual([]);
  });

  it('ignores plunge and spindle on layers that do not output', () => {
    const limits: ControllerSettingsSnapshot = { zMaxFeed: 100, maxPowerS: 5000 };
    const project = cncProject({ plungeMmPerMin: 900, spindleRpm: 24000, output: false });
    expect(detectCncMachineLimitWarnings(project, limits)).toEqual([]);
  });

  it('emits both a stock and a feed advisory together', () => {
    const limits: ControllerSettingsSnapshot = { bedWidth: 300, bedHeight: 300, maxFeed: 500 };
    const warnings = detectCncMachineLimitWarnings(
      cncProject({ stock: { widthMm: 600, heightMm: 600 }, feedMmPerMin: 1000 }),
      limits,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('exceeds the machine');
    expect(warnings[1]).toContain('above the machine');
  });
});
