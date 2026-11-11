// Opens a Moshiboard over the shared USB link (ADR-702, ADR-705): the device
// chooser limited to the CH341 bridge, then the chip in EPP mode with the
// status read MeerK40t uses for a Moshiboard — a vendor control transfer
// (moshi/controller.py opens its CH341 with `bulk=False`). A Lihuiyu board
// has the same CH341 chip, so the operator picks the device every time rather
// than KerfDesk reopening whichever CH341 was granted last.

import { CH341_USB_FILTER, openCh341Epp } from '../../../core/controllers/usb/ch341-epp';
import { UsbLinkOpenError, type UsbLinkAdapter } from '../../../platform/usb-link-types';
import type { MoshiUsbConnection, MoshiUsbOpener } from './moshi-usb-types';

export const MOSHI_NO_DEVICE_CHOSEN =
  'No Moshiboard was chosen. Connect the machine’s USB cable, switch it on, then pick its CH341 device.';

export function moshiUsbOpener(adapter: UsbLinkAdapter): MoshiUsbOpener {
  return async (): Promise<MoshiUsbConnection> => {
    let session;
    try {
      session = await adapter.request([CH341_USB_FILTER]);
    } catch (error) {
      throw new Error(moshiOpenFailureText(error));
    }
    if (session === null) throw new Error(MOSHI_NO_DEVICE_CHOSEN);
    let epp;
    try {
      epp = await openCh341Epp(session, { status: 'control' });
    } catch (error) {
      await session.close().catch(() => undefined);
      throw error;
    }
    return {
      label: `CH341 chip version ${epp.chipVersion}`,
      writeData: epp.writeData,
      writeAddress: epp.writeAddress,
      readStatus: epp.readStatus,
      onDisconnect: session.onDisconnect,
      close: epp.close,
    };
  };
}

/** Says why the chosen device could not be opened, and where help is. */
export function moshiOpenFailureText(error: unknown): string {
  if (!(error instanceof UsbLinkOpenError))
    return error instanceof Error ? error.message : String(error);
  switch (error.failure) {
    case 'driver':
      return 'Windows has not given this device to KerfDesk: it needs the WinUSB driver. See Help → “Can’t connect?” for the steps.';
    case 'busy':
      return 'Another program holds the Moshiboard (MoshiDraw or MeerK40t?). Close it and connect again.';
    case 'gone':
      return 'The Moshiboard went away while it was being opened. Check the cable and connect again.';
    case 'unknown':
      return `The Moshiboard could not be opened: ${error.message}`;
  }
}
