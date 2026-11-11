import { describe, expect, it, vi } from 'vitest';
import { UsbLinkOpenError } from '../usb-link-types';
import { createWebUsbLink, usbOpenError, type WebUsb, type WebUsbDevice } from './web-usb-link';

const K40 = { vendorId: 0x1a86, productId: 0x5512 };
const GALVO = { vendorId: 0x9588, productId: 0x9899 };

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

function fakeDevice(ids = K40, overrides: Partial<WebUsbDevice> = {}): WebUsbDevice {
  const ok = { status: 'ok' as const };
  return {
    ...ids,
    productName: 'USB2.0-Print',
    serialNumber: undefined,
    configuration: null,
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    selectConfiguration: vi.fn(async () => undefined),
    claimInterface: vi.fn(async () => undefined),
    releaseInterface: vi.fn(async () => undefined),
    controlTransferOut: vi.fn(async () => ok),
    controlTransferIn: vi.fn(async () => ({
      ...ok,
      data: new DataView(Uint8Array.of(1, 2).buffer),
    })),
    transferOut: vi.fn(async () => ok),
    transferIn: vi.fn(async () => ({
      ...ok,
      data: new DataView(Uint8Array.of(9, 8, 7).buffer, 1),
    })),
    ...overrides,
  };
}

function fakeUsb(devices: WebUsbDevice[], picked?: WebUsbDevice | Error): WebUsb & EventTarget {
  const target = new EventTarget();
  return Object.assign(target, {
    requestDevice: vi.fn(async () => {
      if (picked instanceof Error) throw picked;
      if (picked === undefined) throw domError('NotFoundError');
      return picked;
    }),
    getDevices: vi.fn(async () => devices),
  });
}

describe('WebUSB laser link (ADR-702)', () => {
  it('asks the chooser for only the listed devices, then opens and claims interface 0', async () => {
    const device = fakeDevice();
    const usb = fakeUsb([], device);
    const session = await createWebUsbLink(usb).request([K40]);
    expect(usb.requestDevice).toHaveBeenCalledWith({ filters: [K40] });
    expect(device.open).toHaveBeenCalled();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(session?.info).toEqual({ ...K40, productName: 'USB2.0-Print' });
  });

  it('resolves null when the operator cancels the chooser', async () => {
    expect(await createWebUsbLink(fakeUsb([])).request([K40])).toBeNull();
  });

  it('reopens only a granted device that matches the filters', async () => {
    const galvo = fakeDevice(GALVO);
    const link = createWebUsbLink(fakeUsb([fakeDevice(), galvo]));
    expect((await link.reopen([GALVO]))?.info.vendorId).toBe(0x9588);
    expect(galvo.claimInterface).toHaveBeenCalledWith(0);
    expect(await createWebUsbLink(fakeUsb([galvo])).reopen([K40])).toBeNull();
  });

  it('explains a device without the WinUSB driver and closes nothing it did not open', async () => {
    const device = fakeDevice(K40, {
      open: vi.fn(async () => Promise.reject(domError('SecurityError'))),
    });
    const failure = createWebUsbLink(fakeUsb([], device)).request([K40]);
    await expect(failure).rejects.toBeInstanceOf(UsbLinkOpenError);
    await expect(failure).rejects.toMatchObject({ failure: 'driver' });
  });

  it('reports a device another program holds as busy, and closes it again', async () => {
    const device = fakeDevice(K40, {
      claimInterface: vi.fn(async () => Promise.reject(domError('NetworkError'))),
    });
    await expect(createWebUsbLink(fakeUsb([], device)).request([K40])).rejects.toMatchObject({
      failure: 'busy',
    });
    expect(device.close).toHaveBeenCalled();
  });

  it('passes transfers through and rejects any status but ok', async () => {
    const device = fakeDevice(K40, {
      transferOut: vi.fn(async () => ({ status: 'stall' as const })),
    });
    const session = await createWebUsbLink(fakeUsb([], device)).request([K40]);
    expect([...((await session?.transferIn(2, 6)) ?? [])]).toEqual([8, 7]);
    expect([
      ...((await session?.controlTransferIn(
        { requestType: 'vendor', recipient: 'device', request: 0x5f, value: 0, index: 0 },
        2,
      )) ?? []),
    ]).toEqual([1, 2]);
    await expect(session?.transferOut(2, Uint8Array.of(1))).rejects.toThrow('stall');
  });

  it('tells only this device’s disconnect, and forget releases then revokes', async () => {
    const device = fakeDevice();
    const usb = fakeUsb([], device);
    const session = await createWebUsbLink(usb).request([K40]);
    const handler = vi.fn();
    const stop = session?.onDisconnect(handler);
    usb.dispatchEvent(Object.assign(new Event('disconnect'), { device: fakeDevice() }));
    expect(handler).not.toHaveBeenCalled();
    usb.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
    expect(handler).toHaveBeenCalledTimes(1);
    stop?.();
    await session?.forget();
    expect(device.releaseInterface).toHaveBeenCalledWith(0);
    expect(device.forget).toHaveBeenCalled();
  });

  it('maps an unknown failure without hiding its name', () => {
    expect(usbOpenError(domError('InvalidStateError'), 'open').message).toContain(
      'InvalidStateError',
    );
    expect(usbOpenError(domError('NotFoundError'), 'open').failure).toBe('gone');
  });
});
