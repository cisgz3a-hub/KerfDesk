import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REMEMBERED_SERIAL_PORTS,
  parseSerialPortGrants,
  readSerialPortGrants,
  SerialPortGrants,
  serialPortGrantsWriter,
} from './serial-port-grants.js';

// Electron's two shapes of one port on Windows: the SerialPort object of the
// Select dialog and the revoked event, and the stored form the device
// permission handler is asked about (serial_chooser_context.cc PortInfoToValue).
const LASER_ID = 'USB\\VID_1A86&PID_7523\\5&2A6E7D8C&0&2';
const TWIN_ID = 'USB\\VID_1A86&PID_7523\\5&2A6E7D8C&0&3';
const laserPort = {
  portId: '9C4B2E0F7A1D4E3B8F6A2C5D1E0B9A87',
  portName: 'COM5',
  displayName: 'USB-SERIAL CH340 (COM5)',
  vendorId: '6790',
  productId: '29987',
  deviceInstanceId: LASER_ID,
};
const twinPort = { ...laserPort, portId: 'B7', portName: 'COM7', deviceInstanceId: TWIN_ID };
const stored = (id: string) => ({ name: 'USB-SERIAL CH340', device_instance_id: id });

describe('SerialPortGrants', () => {
  it('grants a picked port and not its identical twin', () => {
    const save = vi.fn();
    const grants = new SerialPortGrants([], save);
    expect(grants.allows(stored(LASER_ID))).toBe(false);

    grants.recordPick(laserPort, 1000);

    expect(grants.allows(stored(LASER_ID))).toBe(true);
    expect(grants.allows(stored(LASER_ID.toLowerCase()))).toBe(true);
    expect(grants.allows(stored(TWIN_ID))).toBe(false);
    expect(save).toHaveBeenLastCalledWith([{ id: LASER_ID, pickedAt: 1000 }]);
  });

  it('keeps grants it was started with and forgets a port the window forgot', () => {
    const save = vi.fn();
    const grants = new SerialPortGrants([{ id: LASER_ID, pickedAt: 5 }], save);
    expect(grants.allows(stored(LASER_ID))).toBe(true);

    grants.revoke(twinPort);
    expect(save).not.toHaveBeenCalled();
    grants.revoke(laserPort);

    expect(grants.allows(stored(LASER_ID))).toBe(false);
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('answers nothing it cannot identify', () => {
    const grants = new SerialPortGrants([{ id: LASER_ID, pickedAt: 5 }], vi.fn());
    for (const device of [
      null,
      'USB',
      {},
      { name: 'COM5' },
      { device_instance_id: '' },
      { device_instance_id: 42 },
      { device_instance_id: 'X'.repeat(513) },
      { deviceInstanceId: LASER_ID },
    ]) {
      expect(grants.allows(device)).toBe(false);
    }
  });

  it('grants a Bluetooth port picked in this run by its address, without saving it', () => {
    const save = vi.fn();
    const grants = new SerialPortGrants([], save);
    const bluetooth = { portId: 'C1', portName: '00:11:22:33:44:55', displayName: 'HC-05' };
    grants.recordPick(bluetooth);

    expect(grants.allows({ name: 'HC-05', bluetooth_device_path: '00:11:22:33:44:55' })).toBe(true);
    expect(grants.allows({ name: 'HC-05', bluetooth_device_path: '00:11:22:33:44:56' })).toBe(
      false,
    );
    expect(save).not.toHaveBeenCalled();

    grants.revoke(bluetooth);
    expect(grants.allows({ name: 'HC-05', bluetooth_device_path: '00:11:22:33:44:55' })).toBe(
      false,
    );
  });

  it(`remembers the ${MAX_REMEMBERED_SERIAL_PORTS} most recent picks`, () => {
    const saved = Array.from({ length: MAX_REMEMBERED_SERIAL_PORTS + 3 }, (_, i) => ({
      id: `USB\\VID_0403&PID_6001\\A${i}`,
      pickedAt: i,
    }));
    const grants = new SerialPortGrants(saved.reverse(), vi.fn());
    expect(grants.list()).toHaveLength(MAX_REMEMBERED_SERIAL_PORTS);
    expect(grants.allows(stored('USB\\VID_0403&PID_6001\\A2'))).toBe(false);
    expect(grants.allows(stored('USB\\VID_0403&PID_6001\\A3'))).toBe(true);

    grants.recordPick({ ...laserPort }, 100);
    expect(grants.list()).toHaveLength(MAX_REMEMBERED_SERIAL_PORTS);
    expect(grants.allows(stored('USB\\VID_0403&PID_6001\\A3'))).toBe(false);
    expect(grants.list().at(-1)).toEqual({ id: LASER_ID, pickedAt: 100 });
  });

  it('makes the most recently picked listed port the default choice', () => {
    const grants = new SerialPortGrants(
      [
        { id: LASER_ID, pickedAt: 10 },
        { id: TWIN_ID, pickedAt: 20 },
      ],
      vi.fn(),
    );
    const other = { portId: 'D4', portName: 'COM3' };
    expect(grants.preferredIndex([other, laserPort, twinPort])).toBe(2);
    expect(grants.preferredIndex([other, laserPort])).toBe(1);
    expect(grants.preferredIndex([other])).toBe(0);
    expect(grants.preferredIndex([])).toBe(0);
  });
});

describe('saved serial port grants', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'kerfdesk-serial-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads only an exact, current-format file', () => {
    expect(
      parseSerialPortGrants(
        JSON.stringify({ schemaVersion: 1, ports: [{ id: LASER_ID, pickedAt: 7 }] }),
      ),
    ).toEqual([{ id: LASER_ID, pickedAt: 7 }]);
    expect(
      parseSerialPortGrants(
        JSON.stringify({
          schemaVersion: 1,
          ports: [{ id: LASER_ID }, { id: '', pickedAt: 1 }, { id: TWIN_ID, pickedAt: 2 }, null],
        }),
      ),
    ).toEqual([{ id: TWIN_ID, pickedAt: 2 }]);
    for (const text of ['', 'null', '[]', '{"schemaVersion":2,"ports":[]}', '{"ports":{}}', '{']) {
      expect(parseSerialPortGrants(text)).toEqual([]);
    }
  });

  it('treats a missing or oversized file as no grants', () => {
    const dir = tempDir();
    expect(readSerialPortGrants(join(dir, 'missing.json'))).toEqual([]);
    const big = join(dir, 'big.json');
    writeFileSync(big, `{"schemaVersion":1,"ports":[],"pad":"${'x'.repeat(70_000)}"}`);
    expect(readSerialPortGrants(big)).toEqual([]);
  });

  it('writes each change in order and reads it back', async () => {
    const dir = tempDir();
    const file = join(dir, 'nested', 'serial-port-grants.json');
    const write = serialPortGrantsWriter(file);
    write([{ id: TWIN_ID, pickedAt: 1 }]);
    write([{ id: LASER_ID, pickedAt: 2 }]);

    await vi.waitFor(() =>
      expect(readSerialPortGrants(file)).toEqual([{ id: LASER_ID, pickedAt: 2 }]),
    );
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      schemaVersion: 1,
      ports: [{ id: LASER_ID, pickedAt: 2 }],
    });
  });
});
