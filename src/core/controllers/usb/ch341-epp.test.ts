import { describe, expect, it } from 'vitest';
import { createFakeUsbDevice } from '../../../__fixtures__/usb/fake-usb-device';
import { ch341EppFrame, CH341_USB_FILTER, openCh341Epp } from './ch341-epp';

const range = (n: number, from = 0): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => from + i);

/** MeerK40t's CH341EppWrite loop (ch341/libusb.py L425-446), for comparison. */
function meerk40tFrame(command: number, bytes: Uint8Array): number[] {
  const data = [...bytes];
  for (let i = 0; i < bytes.length + 1; i += 32) data.splice(i, 0, command);
  return data;
}

describe('CH341 EPP framing (ADR-702)', () => {
  it('answers to the CH341A USB ids', () => {
    expect(CH341_USB_FILTER).toEqual({ vendorId: 0x1a86, productId: 0x5512 });
  });

  it('prefixes every 31 data bytes with the command byte', () => {
    expect([...ch341EppFrame(0xa6, range(3))]).toEqual([0xa6, 0, 1, 2]);
    const framed = ch341EppFrame(0xa7, range(34));
    expect(framed.length).toBe(36);
    expect(framed[0]).toBe(0xa7);
    expect(framed[32]).toBe(0xa7);
    expect([...framed.subarray(33)]).toEqual([31, 32, 33]);
  });

  it('writes the same bytes as MeerK40t for every length up to 62', () => {
    for (let n = 1; n <= 62; n += 1)
      expect([...ch341EppFrame(0xa6, range(n))], `length ${n}`).toEqual(
        meerk40tFrame(0xa6, range(n)),
      );
  });

  it('never leaves a 32-byte packet without its prefix', () => {
    const framed = ch341EppFrame(0xa6, range(100));
    for (let p = 0; p * 32 < framed.length; p += 1) expect(framed[p * 32]).toBe(0xa6);
    expect(framed.length).toBe(100 + 4);
  });
});

describe('openCh341Epp', () => {
  it('sets EPP 1.9 mode, then reads the chip version', async () => {
    const device = createFakeUsbDevice({ controlIn: () => Uint8Array.of(0x30, 0x00) });
    const epp = await openCh341Epp(device.session, { status: 'bulk' });
    expect(epp.chipVersion).toBe(0x30);
    expect(device.calls.slice(0, 2)).toEqual([
      {
        kind: 'control-out',
        setup: {
          requestType: 'vendor',
          recipient: 'device',
          request: 0xb1,
          value: 0x0102,
          index: 0,
        },
      },
      {
        kind: 'control-in',
        setup: { requestType: 'vendor', recipient: 'device', request: 0x5f, value: 0, index: 0 },
        length: 2,
      },
    ]);
  });

  it('sends data and address writes framed on bulk endpoint 2, and nothing for no bytes', async () => {
    const device = createFakeUsbDevice();
    const epp = await openCh341Epp(device.session, { status: 'bulk' });
    await epp.writeData(Uint8Array.of(1, 2));
    await epp.writeAddress(Uint8Array.of(9));
    await epp.writeData(new Uint8Array(0));
    expect(device.writes().map((bytes) => [...bytes])).toEqual([
      [0xa6, 1, 2],
      [0xa7, 9],
    ]);
    expect(device.calls.filter((c) => c.kind === 'out').every((c) => c.endpoint === 2)).toBe(true);
  });

  it('reads a Lihuiyu status by bulk: A0 out, six bytes in', async () => {
    const device = createFakeUsbDevice({ transferIn: () => Uint8Array.of(255, 206, 0, 0, 0, 1) });
    const epp = await openCh341Epp(device.session, { status: 'bulk' });
    const status = await epp.readStatus();
    expect(status[1]).toBe(206);
    expect(device.calls.slice(-2)).toEqual([
      { kind: 'out', endpoint: 2, data: Uint8Array.of(0xa0) },
      { kind: 'in', endpoint: 2, length: 6 },
    ]);
  });

  it('reads a Moshiboard status by control transfer 0x52, eight bytes', async () => {
    const device = createFakeUsbDevice({
      controlIn: (setup) =>
        setup.request === 0x52 ? Uint8Array.of(0, 205, 0, 0, 0, 0, 0, 0) : Uint8Array.of(0x30, 0),
    });
    const epp = await openCh341Epp(device.session, { status: 'control' });
    expect((await epp.readStatus())[1]).toBe(205);
    expect(device.calls.at(-1)).toEqual({
      kind: 'control-in',
      setup: { requestType: 'vendor', recipient: 'device', request: 0x52, value: 0, index: 0 },
      length: 8,
    });
  });

  it('closes the session', async () => {
    const device = createFakeUsbDevice();
    const epp = await openCh341Epp(device.session, { status: 'bulk' });
    await epp.close();
    expect(device.isClosed()).toBe(true);
  });
});
