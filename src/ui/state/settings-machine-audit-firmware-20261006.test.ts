import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, grblHalDriver, type ControllerDriver } from '../../core/controllers';
import { idleCollector, settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE, validateMachineProfile } from '../../core/devices';
import { LASER_MACHINE_CONFIG } from '../../core/scene';
import { computeFirmwareDiffs } from '../laser/device-setup/device-setup-firmware-diff';
import { grblSettingsActions } from './grbl-settings-actions';
import { consumeControllerCommandResponse } from './laser-interactive-command';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import type { LaserState } from './laser-store';

beforeEach(resetStore);
afterEach(resetStore);

function settingWriteHarness(
  readback: string,
  driver: ControllerDriver = grblDriver,
  interpretSetting?: (wireValue: string) => string,
) {
  const rows = settingsMapToRows(
    new Map([
      [30, '1000'],
      [11, '0.010'],
      [32, '1'],
      [1, '255'],
    ]),
  );
  let state = {
    ...initialLaserState(),
    connection: { kind: 'connected' as const },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    } as const,
    grblSettingsRows: rows,
    controllerSessionEpoch: 1,
    controllerQualification: {
      kind: 'qualified' as const,
      epoch: 1,
      settings: 'verified' as const,
    },
    lastSettingsReadAt: Date.now(),
  } as LaserState;
  const refs = {
    driver,
    settingsCollector: idleCollector(),
    settingsCollectorSessionEpoch: null,
    controllerCommand: null,
    controllerIdleWait: null,
  } as Parameters<typeof grblSettingsActions>[2];
  let writtenId = 30;
  let observedReadback = readback;
  // Only plain decimal setting commands receive a terminal acknowledgement.
  // The simulated $$ read is separate from that acknowledgement, and retains
  // stock GRBL's rounded report precision (e.g. a tiny $30 is printed as 0).
  const wire = vi.fn(async (line: string) => {
    if (line === '$$\n') {
      state = {
        ...state,
        grblSettingsRows: settingsMapToRows(new Map([[writtenId, observedReadback]])),
        controllerQualification: { kind: 'qualified', epoch: 1, settings: 'verified' },
        lastSettingsReadAt: Date.now(),
      };
      refs.settingsCollector = idleCollector();
      refs.settingsCollectorSessionEpoch = null;
    } else {
      const setting = /^\$(\d+)=([+-]?(?:\d+(?:\.\d*)?|\.\d+))\n$/.exec(line);
      if (setting === null) throw new Error('Stock GRBL invalid-statement refusal');
      writtenId = Number(setting[1]);
      observedReadback = interpretSetting?.(setting[2]!) ?? readback;
    }
    consumeControllerCommandResponse(refs, { kind: 'ok' }, 'ok');
  });
  const actions = grblSettingsActions(
    (patch) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    },
    () => state,
    refs,
    wire,
  );
  return { actions, wire, rows, getState: () => state };
}

describe('machine settings audit: profile number spelling at the firmware boundary', () => {
  it('writes the valid imported tiny profile maximum as a decimal, then verifies the rounded report', async () => {
    const profile = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1e-7 };
    expect(validateMachineProfile(profile)).toEqual([]);
    const harness = settingWriteHarness('0');
    const diff = computeFirmwareDiffs(profile, harness.rows, { machine: LASER_MACHINE_CONFIG })[0];
    if (!diff) throw new Error('Maximum S firmware diff fixture missing');
    expect(diff.desired).toBe('0.0000001');
    useStore.setState((current) => ({
      project: { ...current.project, device: profile, machine: LASER_MACHINE_CONFIG },
    }));
    await expect(harness.actions.writeGrblSetting(30, diff.desired)).resolves.toBeUndefined();
    expect(harness.wire.mock.calls.map((call) => call[0])).toEqual(['$30=0.0000001\n', '$$\n']);
    expect(harness.getState().controllerOperation).toBeNull();
    expect(useStore.getState().project.device.maxPowerS).toBe(1e-7);
  });

  it.each([
    [30, '1e-7', '0.0000001', '0'],
    [30, '1e-8', '.00000001', '0'],
    [30, '1.1e-7', '.00000011', '0'],
    [11, '0.01050001', '.01050001', '0.011'],
    [30, '1E+3', '1000', '1000'],
    [11, '1.05e-2', '0.0105', '0.011'],
    [30, ' 1000.12500 ', '1000.12500', '1000'],
    [11, '0.0105000', '0.0105000', '0.011'],
  ] as const)(
    'encodes direct $%s=%s without changing the requested decimal precision',
    async (id, input, decimal, readback) => {
      const harness = settingWriteHarness(readback);
      await expect(harness.actions.writeGrblSetting(id, input)).resolves.toBeUndefined();
      expect(harness.wire.mock.calls.map((call) => call[0])).toEqual([
        `$${id}=${decimal}\n`,
        '$$\n',
      ]);
    },
  );

  it.each([
    '1e-9',
    '1.23e-7',
    '1e39',
    '1e1000000',
    '1e-1000000',
    '0x10',
    '0b10',
    '1.2.3',
    String(Number.MIN_VALUE),
    String(Number.MAX_VALUE),
  ])(
    'refuses unrepresentable or invalid $30=%s before transport and qualification changes',
    async (input) => {
      const harness = settingWriteHarness('1000');
      const qualification = harness.getState().controllerQualification;
      await expect(harness.actions.writeGrblSetting(30, input)).rejects.toThrow();
      expect(harness.wire).not.toHaveBeenCalled();
      expect(harness.getState().controllerOperation).toBeNull();
      expect(harness.getState().controllerQualification).toBe(qualification);
      expect(harness.getState().grblSettingsRows).toBe(harness.rows);
    },
  );

  it('still refuses non-canonical laser mode instead of normalizing around its existing rule', async () => {
    const harness = settingWriteHarness('1');
    await expect(harness.actions.writeGrblSetting(32, '1e0')).rejects.toThrow('Only exact $32=1');
    expect(harness.wire).not.toHaveBeenCalled();
  });

  it('retains verification failure when the controller reports a genuinely different value', async () => {
    const harness = settingWriteHarness('500');
    await expect(harness.actions.writeGrblSetting(30, '1e3')).rejects.toThrow(
      'it stored a different value',
    );
    expect(harness.wire.mock.calls.map((call) => call[0])).toEqual(['$30=1000\n', '$$\n']);
    expect(harness.getState().controllerOperation).toBeNull();
  });

  it('preserves additional grblHAL decimal precision with its own parser restriction', async () => {
    const harness = settingWriteHarness('0.00000001', grblHalDriver);
    await expect(harness.actions.writeGrblSetting(30, '1e-8')).resolves.toBeUndefined();
    expect(harness.wire.mock.calls.map((call) => call[0])).toEqual(['$30=0.00000001\n', '$$\n']);
  });

  it.each([
    ['1e39', 'cannot store a finite value'],
    ['1e-46', 'would store this non-zero decimal as zero'],
    ['1.0000000599', 'dropping non-zero digits'],
  ])('refuses unrepresentable grblHAL $30=%s before claiming transport', async (input, reason) => {
    const harness = settingWriteHarness('1000', grblHalDriver);
    const qualification = harness.getState().controllerQualification;
    await expect(harness.actions.writeGrblSetting(30, input)).rejects.toThrow(reason);
    expect(harness.wire).not.toHaveBeenCalled();
    expect(harness.getState().controllerOperation).toBeNull();
    expect(harness.getState().controllerQualification).toBe(qualification);
    expect(harness.getState().grblSettingsRows).toBe(harness.rows);
  });

  it.each(['25.0', '25.00', '25.000'])(
    'stores requested HAL integer %s before readback verification',
    async (input) => {
      // The pinned HAL read_uint multiplies its accumulator for fractional
      // zeroes too. This independent oracle would turn 25.0 into 250 if sent.
      const harness = settingWriteHarness('255', grblHalDriver, (wire) =>
        String(Number(wire.replace('.', ''))),
      );
      await expect(harness.actions.writeGrblSetting(1, input)).resolves.toBeUndefined();
      expect(harness.wire.mock.calls.map((call) => call[0])).toEqual(['$1=25\n', '$$\n']);
      expect(harness.getState().grblSettingsRows[0]?.numericValue).toBe(25);
      expect(harness.getState().lastWriteError).toBeNull();
    },
  );

  it('refuses a genuinely fractional HAL integer before any transport or durable setting change', async () => {
    const harness = settingWriteHarness('255', grblHalDriver);
    const qualification = harness.getState().controllerQualification;
    await expect(harness.actions.writeGrblSetting(1, '25.00000000000000000001')).rejects.toThrow(
      'integer',
    );
    expect(harness.wire).not.toHaveBeenCalled();
    expect(harness.getState().controllerQualification).toBe(qualification);
    expect(harness.getState().grblSettingsRows).toBe(harness.rows);
  });
});
