import { describe, expect, it } from 'vitest';
import { classifyResponse } from './response';
import {
  idleCollector,
  onResponse,
  settingsMapToControllerSettings,
  settingsMapToProfilePatch,
  startCollecting,
} from './parse-settings';

// Historical synthetic GRBL-family settings fixture, not a verified Falcon
// readback. Its legacy name does not qualify the machine dimensions or firmware.
// Trimmed to the lines our collector reads, including the laser-mode setting.
const FALCON_DUMP = [
  '$11=0.010',
  '$22=0',
  '$30=1000',
  '$31=0',
  '$32=1',
  '$110=10000.000',
  '$111=10000.000',
  '$120=2500.000',
  '$121=2500.000',
  '$130=400.000',
  '$131=400.000',
];

describe('settingsMapToProfilePatch', () => {
  it('maps a complete Falcon-like dump to a full DeviceProfile patch', () => {
    const map = new Map<number, string>([
      [11, '0.010'],
      [22, '0'],
      [30, '1000'],
      [31, '0'],
      [32, '1'],
      [110, '10000.000'],
      [111, '10000.000'],
      [120, '2500.000'],
      [121, '2500.000'],
      [130, '400.000'],
      [131, '400.000'],
    ]);
    const patch = settingsMapToProfilePatch(map);
    expect(patch.junctionDeviationMm).toBe(0.01);
    expect(patch.maxPowerS).toBe(1000);
    expect(patch).toMatchObject({ minPowerS: 0, laserModeEnabled: true });
    expect(patch.maxFeed).toBe(10000);
    expect(patch.accelMmPerSec2).toBe(2500);
    expect(patch.bedWidth).toBe(400);
    expect(patch.bedHeight).toBe(400);
  });

  it('maps $22 into controller settings without mutating the device profile patch', () => {
    const map = new Map<number, string>([
      [22, '1'],
      [30, '1000'],
    ]);

    expect(settingsMapToControllerSettings(map)).toMatchObject({
      homingEnabled: true,
      maxPowerS: 1000,
    });
    expect(settingsMapToProfilePatch(map)).not.toHaveProperty('homing');
  });

  it('captures Neotronics-relevant limit, homing, and Z-axis settings from $$', () => {
    const map = new Map<number, string>([
      [20, '1'],
      [21, '1'],
      [22, '1'],
      [23, '3'],
      [10, '1'],
      [13, '0'],
      [27, '2.500'],
      [112, '800.000'],
      [122, '50.000'],
      [132, '75.000'],
    ]);

    expect(settingsMapToControllerSettings(map)).toMatchObject({
      softLimitsEnabled: true,
      hardLimitsEnabled: true,
      homingEnabled: true,
      homingDirectionMask: 3,
      statusReportMask: 1,
      reportInches: false,
      homingPullOffMm: 2.5,
      zMaxFeed: 800,
      zAccelMmPerSec2: 50,
      zTravelMm: 75,
    });
    expect(settingsMapToProfilePatch(map)).toEqual({ zTravelMm: 75 });
  });

  // grblHAL reports $21 and $22 as bitfields whose bit 0 is "Enable" and prints
  // the whole value (grblHAL core settings.c#L2377-L2385, #L473, #L1765-L1780),
  // so `$22=5` is homing enabled; stock GRBL prints that bit alone as 0 or 1
  // (grbl report.c#L197-L198). ADR-375.
  it('reads grblHAL $21/$22 bitfields by their Enable bit', () => {
    const enabled = new Map([
      [20, '1'],
      [21, '3'],
      [22, '5'],
    ]);
    expect(settingsMapToControllerSettings(enabled)).toEqual({
      softLimitsEnabled: true,
      hardLimitsEnabled: true,
      homingEnabled: true,
    });
    const optionsWithoutEnable = new Map([
      [21, '2'],
      [22, '4'],
    ]);
    expect(settingsMapToControllerSettings(optionsWithoutEnable)).toEqual({
      hardLimitsEnabled: false,
      homingEnabled: false,
    });
  });

  it('leaves a $21/$22 value that is not a non-negative integer unknown', () => {
    for (const value of ['-1', '0.5', '1.5', 'on']) {
      const map = new Map([
        [21, value],
        [22, value],
      ]);
      expect(settingsMapToControllerSettings(map)).toEqual({});
    }
  });

  it('preserves a stock-valid zero homing pull-off for later product policy', () => {
    expect(settingsMapToControllerSettings(new Map([[27, '0']]))).toEqual({
      homingPullOffMm: 0,
    });
  });

  // grblHAL `$384` "Disable G92 persistence" (Format_Bool): off, the default,
  // grblHAL saves a G92 origin and restores it at power-up (core
  // settings.c#L2475-L2477, gcode.c#L833-L838). Read only, never written. ADR-375.
  it('reads grblHAL $384 so KerfDesk can say whether Set origin here survives power-off', () => {
    expect(settingsMapToControllerSettings(new Map([[384, '0']]))).toEqual({
      g92PersistenceDisabled: false,
    });
    expect(settingsMapToControllerSettings(new Map([[384, '1']]))).toEqual({
      g92PersistenceDisabled: true,
    });
    expect(settingsMapToControllerSettings(new Map([[384, '2']]))).toEqual({});
    expect(settingsMapToProfilePatch(new Map([[384, '0']]))).toEqual({});
  });

  // One step's length bounds how far a reported MPos sits from the firmware's
  // own position, so the jog clamp keeps that much room (ADR-375).
  it('keeps $100 and $101 so the jog clamp can size its margin', () => {
    const map = new Map([
      [100, '40.000'],
      [101, '80'],
      [102, '0'],
    ]);
    expect(settingsMapToControllerSettings(map)).toEqual({ stepsPerMmX: 40, stepsPerMmY: 80 });
    expect(settingsMapToProfilePatch(map)).toEqual({});
  });

  it('retains the reported Z step resolution for CNC Frame completion', () => {
    expect(settingsMapToControllerSettings(new Map([[102, '400.000']]))).toEqual({
      stepsPerMmZ: 400,
    });
    expect(settingsMapToProfilePatch(new Map([[102, '400.000']]))).toEqual({});
  });

  it('takes the max of $110/$111 for maxFeed (vector reach)', () => {
    const map = new Map([
      [110, '3000'],
      [111, '5000'],
    ]);
    expect(settingsMapToProfilePatch(map).maxFeed).toBe(5000);
  });

  it('retains the raw per-axis rates on the snapshot for the slow-axis advisory (R4)', () => {
    const map = new Map([
      [110, '10000'],
      [111, '1000'],
    ]);
    // maxFeed collapses to the greater (for the planner); the snapshot keeps both.
    expect(settingsMapToControllerSettings(map)).toMatchObject({
      maxFeed: 10000,
      maxFeedX: 10000,
      maxFeedY: 1000,
    });
    // Not DeviceProfile keys — they stay OUT of the profile patch.
    expect(settingsMapToProfilePatch(map)).toEqual({ maxFeed: 10000 });
  });

  it('takes the min of $120/$121 for accel (slowest axis bounds the planner)', () => {
    const map = new Map([
      [120, '1000'],
      [121, '500'],
    ]);
    expect(settingsMapToProfilePatch(map).accelMmPerSec2).toBe(500);
  });

  it('omits a field when only one of its axes parsed', () => {
    // Asymmetric machines or partial dumps: one axis present, one missing.
    // We still produce a value from the single axis rather than dropping
    // the field — better one estimate than none.
    const map = new Map([[110, '4000']]);
    expect(settingsMapToProfilePatch(map).maxFeed).toBe(4000);
  });

  it('returns an empty patch when no recognized settings parse', () => {
    expect(settingsMapToProfilePatch(new Map())).toEqual({});
    expect(
      settingsMapToProfilePatch(
        new Map([
          [22, '1'],
          [33, '1'],
        ]),
      ),
    ).toEqual({});
  });

  it('maps disabled laser mode so Start can block unsafe M4 assumptions', () => {
    expect(settingsMapToProfilePatch(new Map([[32, '0']]))).toEqual({
      laserModeEnabled: false,
    });
  });

  // grblHAL widened $32 from grbl's laser-mode boolean into a three-way
  // "Mode of operation" enum (system.h: machine_mode_t { Mode_Standard = 0,
  // Mode_Laser, Mode_Lathe }), so a lathe reports $32=2. Reading $32 as 0/1
  // dropped the field entirely, which every downstream reader interprets as
  // "the controller never reported $32" — a different fact from "the
  // controller reported lathe mode".
  it('records a grblHAL lathe ($32=2) as lathe, not as an unreported setting', () => {
    const settings = settingsMapToControllerSettings(new Map([[32, '2']]));

    expect(settings.machineMode).toEqual({ kind: 'lathe' });
    // A lathe is provably NOT in laser mode: grblHAL holds one mode enum.
    expect(settings.laserModeEnabled).toBe(false);
  });

  it('keeps the reported mode on the snapshot for $32=0 and $32=1', () => {
    expect(settingsMapToControllerSettings(new Map([[32, '0']]))).toMatchObject({
      machineMode: { kind: 'standard' },
      laserModeEnabled: false,
    });
    expect(settingsMapToControllerSettings(new Map([[32, '1']]))).toMatchObject({
      machineMode: { kind: 'laser' },
      laserModeEnabled: true,
    });
  });

  it('leaves laser mode unproven for a $32 value no firmware defines', () => {
    const settings = settingsMapToControllerSettings(new Map([[32, '7']]));

    expect(settings.machineMode).toEqual({ kind: 'unrecognized', raw: '7' });
    expect(settings).not.toHaveProperty('laserModeEnabled');
  });

  it('omits the mode entirely when the dump did not report $32', () => {
    expect(settingsMapToControllerSettings(new Map([[30, '1000']]))).not.toHaveProperty(
      'machineMode',
    );
  });

  // machineMode is controller evidence, not a DeviceProfile field.
  it('keeps machineMode out of the DeviceProfile patch', () => {
    expect(settingsMapToProfilePatch(new Map([[32, '2']]))).toEqual({ laserModeEnabled: false });
  });

  it('rejects non-numeric or non-positive values rather than poisoning the profile', () => {
    // A machine reporting $130=0 (no homing, no max travel) shouldn't
    // collapse the bed to zero — drop the field instead.
    expect(settingsMapToProfilePatch(new Map([[130, '0']]))).toEqual({});
    expect(settingsMapToProfilePatch(new Map([[120, '-5']]))).toEqual({});
    expect(settingsMapToProfilePatch(new Map([[11, 'abc']]))).toEqual({});
  });
});

describe('SettingsCollector state machine', () => {
  it('idle ignores all responses', () => {
    let state = idleCollector();
    for (const line of FALCON_DUMP) {
      state = onResponse(state, classifyResponse(line));
    }
    state = onResponse(state, classifyResponse('ok'));
    expect(state.kind).toBe('idle');
  });

  it('collecting accumulates settings and transitions to done on the trailing ok', () => {
    let state: ReturnType<typeof startCollecting> | ReturnType<typeof onResponse> =
      startCollecting();
    for (const line of FALCON_DUMP) {
      state = onResponse(state, classifyResponse(line));
    }
    expect(state.kind).toBe('collecting');
    state = onResponse(state, classifyResponse('ok'));
    expect(state.kind).toBe('done');
    if (state.kind === 'done') {
      expect(state.patch.bedWidth).toBe(400);
      expect(state.patch.accelMmPerSec2).toBe(2500);
      expect(state.controllerSettings.homingEnabled).toBe(false);
      expect(state.settingsRows.map((row) => row.code)).toContain('$32');
    }
  });

  it('collector done state keeps unknown settings visible for Machine Settings backup', () => {
    let state: ReturnType<typeof startCollecting> | ReturnType<typeof onResponse> =
      startCollecting();
    state = onResponse(state, classifyResponse('$30=1000'));
    state = onResponse(state, classifyResponse('$999=custom'));
    state = onResponse(state, classifyResponse('ok'));

    expect(state.kind).toBe('done');
    if (state.kind === 'done') {
      expect(state.settingsRows).toEqual([
        expect.objectContaining({ code: '$30', known: true }),
        expect.objectContaining({
          code: '$999',
          rawValue: 'custom',
          known: false,
          name: 'Unknown GRBL setting',
        }),
      ]);
    }
  });

  it('ignores a pre-collection ok (e.g., handshake ack arriving before any setting)', () => {
    // Bug guard: an `ok` that lands while map is empty must NOT close the
    // window early. Real GRBL boards send a welcome banner on connect, and
    // a status-poll reply could interleave with the $$ response.
    let state = startCollecting();
    state = onResponse(state, classifyResponse('ok'));
    expect(state.kind).toBe('collecting');
  });

  it('treats `[MSG:...]` and status reports as no-ops', () => {
    // Status polls (`?` → `<Idle|...>`) and bracketed messages can arrive
    // while $$ is streaming. The collector must pass them through without
    // disrupting the in-progress map.
    let state = startCollecting();
    state = onResponse(state, classifyResponse('$30=1000'));
    state = onResponse(state, classifyResponse('<Idle|MPos:0,0,0|FS:0,0>'));
    state = onResponse(state, classifyResponse('[MSG:Pgm End]'));
    expect(state.kind).toBe('collecting');
    state = onResponse(state, classifyResponse('ok'));
    expect(state.kind).toBe('done');
    if (state.kind === 'done') expect(state.patch.maxPowerS).toBe(1000);
  });
});
