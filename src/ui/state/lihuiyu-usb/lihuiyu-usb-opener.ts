// Opens a K40's Lihuiyu board for the USB store (ADR-703) through the platform's
// USB link (ADR-702): the chooser limited to the CH341 bridge, then the bridge in
// EPP mode with the bulk status read MeerK40t uses for Lihuiyu boards
// (lihuiyu/controller.py `bulk=True`).

import { CH341_USB_FILTER, openCh341Epp } from '../../../core/controllers/usb/ch341-epp';
import { UsbLinkOpenError, type UsbLinkAdapter } from '../../../platform/usb-link-types';
import type { LihuiyuUsbConnection, LihuiyuUsbOpener } from './lihuiyu-usb-types';

export const LIHUIYU_DRIVER_HELP =
  'Windows still has the board’s own driver: install WinUSB for it (Help → Can’t connect? has the steps), then connect again.';

export function lihuiyuUsbOpener(adapter: UsbLinkAdapter): LihuiyuUsbOpener {
  return async (): Promise<LihuiyuUsbConnection | null> => {
    let session;
    try {
      session = await adapter.request([CH341_USB_FILTER]);
    } catch (error) {
      if (error instanceof UsbLinkOpenError && error.failure === 'driver') {
        throw new Error(`${error.message} ${LIHUIYU_DRIVER_HELP}`);
      }
      throw error;
    }
    if (session === null) return null;
    const opened = session;
    const epp = await openCh341Epp(opened, { status: 'bulk' }).catch(async (error: unknown) => {
      await opened.close().catch(() => undefined);
      throw error;
    });
    return {
      channel: { writeData: epp.writeData, readStatus: epp.readStatus },
      label: opened.info.productName ?? 'K40 board (CH341)',
      onDisconnect: opened.onDisconnect,
      close: epp.close,
    };
  };
}
