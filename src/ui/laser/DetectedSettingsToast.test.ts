import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { announceDetectedSettings, detectedSettingsPortKey } from './DetectedSettingsToast';

const PORT = detectedSettingsPortKey({ usbVendorId: 0x1a86, usbProductId: 0x7523 }, 1);
const OTHER_PORT = detectedSettingsPortKey({ usbVendorId: 0x2341, usbProductId: 0x0043 }, 1);

function read(
  overrides: {
    readonly patch?: Parameters<typeof announceDetectedSettings>[0]['patch'];
    readonly homingEnabled?: boolean;
  } = {},
) {
  return {
    patch: overrides.patch ?? null,
    current: DEFAULT_DEVICE_PROFILE,
    controllerSettings:
      overrides.homingEnabled === undefined ? {} : { homingEnabled: overrides.homingEnabled },
    settingsRows: settingsMapToRows(new Map([[30, '1000']])),
  };
}

describe('announceDetectedSettings (ADR-648, audit F-5)', () => {
  it('stays silent for a read with nothing to report', () => {
    expect(announceDetectedSettings(read(), new Map(), PORT)).toBeNull();
  });

  it('announces review items once, then stays silent while a re-read reports the same', () => {
    const memory = new Map<string, ReadonlySet<string>>();

    expect(announceDetectedSettings(read({ homingEnabled: true }), memory, PORT)).toBe(
      'Machine settings detected: review controller homing and limit settings in Machine Setup.',
    );
    expect(announceDetectedSettings(read({ homingEnabled: true }), memory, PORT)).toBeNull();
    expect(announceDetectedSettings(read({ homingEnabled: true }), memory, PORT)).toBeNull();
  });

  it('announces again when a read finds something the last read on this port did not', () => {
    const memory = new Map<string, ReadonlySet<string>>();
    announceDetectedSettings(read({ homingEnabled: true }), memory, PORT);

    expect(announceDetectedSettings(read({ homingEnabled: false }), memory, PORT)).toBe(
      'Machine settings detected: review controller homing and limit settings in Machine Setup.',
    );
    expect(announceDetectedSettings(read({ patch: { maxPowerS: 255 } }), memory, PORT)).toBe(
      'Machine settings detected: safe profile updates are ready in Machine Setup.',
    );
  });

  it('keeps each port apart', () => {
    const memory = new Map<string, ReadonlySet<string>>();
    announceDetectedSettings(read({ homingEnabled: true }), memory, PORT);

    expect(announceDetectedSettings(read({ homingEnabled: true }), memory, OTHER_PORT)).not.toBe(
      null,
    );
  });

  it('keeps the same USB port across reconnects but never merges unidentified connections', () => {
    const usb = { usbVendorId: 0x1a86, usbProductId: 0x7523 };
    expect(detectedSettingsPortKey(usb, 1)).toBe(detectedSettingsPortKey(usb, 2));

    const memory = new Map<string, ReadonlySet<string>>();
    const firstHost = detectedSettingsPortKey({ transport: 'tcp' }, 3);
    const secondHost = detectedSettingsPortKey({ transport: 'tcp' }, 4);
    announceDetectedSettings(read({ homingEnabled: true }), memory, firstHost);

    expect(secondHost).not.toBe(firstHost);
    expect(announceDetectedSettings(read({ homingEnabled: true }), memory, secondHost)).not.toBe(
      null,
    );
    expect(detectedSettingsPortKey(null, 5)).not.toBe(detectedSettingsPortKey(null, 6));
  });
});
