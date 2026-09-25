// Upstream-shaped Smoothieware V1 serial behaviour for the CG repro tests
// (non-grbl mode, the stock firmware.bin default). Unlike
// src/__fixtures__/controllers/smoothie-simulator.ts it follows upstream on Ctrl-X:
// the board ALWAYS halts (Kernel::call_event ON_HALT sets halted = true) and prints
// "HALTED, M999 or $X to exit HALT state" -- it does not reboot or print a banner.
// Halted, only the allowed M-codes run (GcodeDispatch.cpp allowed_mcodes) and every
// other line answers `!!`; `fire off` prints nothing (Laser.cpp returns while halted).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/SerialConsole.cpp#L199-L245
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L34-L180
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L124-L155

import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';

export type UpstreamSmoothie = FakeSerialPort & { readonly isHalted: () => boolean };

const HALT_ALLOWED_M = new Set([2, 5, 9, 30, 105, 114, 115, 119, 80, 81, 911, 503, 106, 107]);

export function createUpstreamSmoothie(): UpstreamSmoothie {
  const port = createFakeSerialPort();
  let halted = false;
  let rx = '';
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const status = (): string =>
    `<${halted ? 'Alarm' : 'Idle'}|MPos:0.0000,0.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0>`;
  const handleLine = (line: string): void => {
    // SimpleShell `$H` clears a halt and homes, then prints ok (SimpleShell.cpp L239-L251).
    if (line === '$H') {
      halted = false;
      emit('ok');
      return;
    }
    if (line === 'fire off') {
      if (!halted) emit('turning laser off and returning to auto mode');
      return;
    }
    const m = /^M(\d+)/i.exec(line);
    if (m !== null && Number(m[1]) === 999) {
      if (halted) {
        halted = false;
        emit('WARNING: After HALT you should HOME as position is currently unknown');
      }
      emit('ok');
      return;
    }
    if (halted && (m === null || !HALT_ALLOWED_M.has(Number(m[1])))) {
      emit('!!');
      return;
    }
    emit('ok');
  };
  port.onOpen(() => {
    emit('Smoothie');
    emit('ok');
  });
  port.onWrite((data) => {
    for (const ch of data) {
      if (ch === '?') {
        emit(status());
        continue;
      }
      if (ch === '\x18') {
        halted = true;
        rx = '';
        emit('HALTED, M999 or $X to exit HALT state');
        continue;
      }
      if (ch === '\n') {
        const line = rx.trim();
        rx = '';
        if (line !== '') handleLine(line);
        continue;
      }
      if (ch !== '\r') rx += ch;
    }
  });
  return { ...port, isHalted: () => halted };
}
