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
//
// SimpleShell (lines that start with `$` or a lowercase letter; GcodeDispatch
// ignores them, GcodeDispatch.cpp L75-L82) prints `ok` only for $G, $#, $H and $X
// while halted. Every other shell command prints its own text and never `ok`
// (SimpleShell.cpp L205-L297); `switch <name> on` prints "switch <name> set to: on"
// or "<name> is not a known switch device" (L1001-L1014). Comment-only lines are
// answered `ok` by GcodeDispatch (L467-L469).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L205-L297

import { createFakeSerialPort, type FakeSerialPort } from '../../__fixtures__/controllers';

export type UpstreamSmoothie = FakeSerialPort & {
  readonly isHalted: () => boolean;
  readonly isMoving: () => boolean;
};

export type UpstreamSmoothieOptions = {
  /** When set, every G0-G3 line with an axis word runs this long, `?` reports
   *  Run meanwhile, M400 answers only after the queued moves (Conveyor
   *  wait_for_idle) and Ctrl-X stops the motion (ON_HALT flushes the queue). */
  readonly motionMsPerMove?: number;
  /** Head machine position. With it, `G92 X<a> Y<b>` sets the G92 offset so the
   *  work position reads a,b, `G92.1`/bare `G92` clear it, G54-G59 leave it alone
   *  (Robot.cpp L612-L662, mcs2wcs L449-L455), and `?` prints MPos and
   *  WPos = mcs2wcs(MPos). Without it every report prints 0,0. */
  readonly headMpos?: { readonly x: number; readonly y: number };
};

const HALT_ALLOWED_M = new Set([2, 5, 9, 30, 105, 114, 115, 119, 80, 81, 911, 503, 106, 107]);

export function createUpstreamSmoothie(options: UpstreamSmoothieOptions = {}): UpstreamSmoothie {
  const port = createFakeSerialPort();
  let halted = false;
  let movingUntil = 0;
  let rx = '';
  const moving = (): boolean => Date.now() < movingUntil;
  const head = options.headMpos ?? { x: 0, y: 0 };
  let g92 = { x: 0, y: 0 };
  const axis = (line: string, letter: 'X' | 'Y'): number | null => {
    const match = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`).exec(line);
    return match === null ? null : Number(match[1]);
  };
  const fmt = (n: number): string => n.toFixed(4);
  const emit = (line: string): void => {
    setTimeout(() => port.emitLine(line), 1);
  };
  const status = (): string =>
    `<${halted ? 'Alarm' : moving() ? 'Run' : 'Idle'}|MPos:${fmt(head.x)},${fmt(head.y)},0.0000|WPos:${fmt(head.x - g92.x)},${fmt(head.y - g92.y)},0.0000|F:4000.0,100.0>`;
  // SimpleShell::on_console_line_received for `$` lines other than $H.
  const handleDollar = (line: string): void => {
    switch (line[1]) {
      case 'G':
        emit('[GC:G0 G54 G17 G21 G90 G94 M0 M5 M9 T1 F4000.0000 S0.8000]');
        emit('ok');
        return;
      case '#':
        emit('ok');
        return;
      case 'X':
        if (halted) {
          halted = false;
          emit('[Caution: Unlocked]');
          emit('ok');
        }
        return;
      case 'I':
        emit(status());
        return;
      case 'S':
      case 'J':
        return;
      default:
        emit('error:Invalid statement');
    }
  };
  // SimpleShell::on_console_line_received for lowercase lines (no `ok` ever).
  const handleShell = (line: string): void => {
    const [cmd = '', name = '', value = ''] = line.split(/\s+/);
    if (cmd === 'switch') {
      // SimpleShell.cpp L991-L1014 (assumes the named switch module exists).
      if (value === 'on' || value === 'off') emit(`switch ${name} set to: ${value}`);
      else if (value === '') emit(`switch ${name} is 0`);
      else emit('must be either on or off');
      return;
    }
    if (cmd === 'version') {
      emit(
        'Build version: edge-38e2cc0, Build date: Jul 19 2026 00:00:00, MCU: LPC1769, System Clock: 120MHz',
      );
      return;
    }
    emit(`error:Unsupported command - ${cmd}`);
  };
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
    if (line.startsWith('$')) {
      handleDollar(line);
      return;
    }
    if (/^[a-z]/.test(line)) {
      handleShell(line);
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
    if (options.headMpos !== undefined && /^G92(?![\d])/.test(line)) {
      const rest = line.replace(/^G92(\.\d+)?/, '');
      const x = axis(rest, 'X');
      const y = axis(rest, 'Y');
      if (/^G92\.[12]/.test(line) || (x === null && y === null)) g92 = { x: 0, y: 0 };
      else g92 = { x: x === null ? g92.x : head.x - x, y: y === null ? g92.y : head.y - y };
    }
    const perMove = options.motionMsPerMove;
    if (perMove !== undefined && /^G[0-3](?!\d)/.test(line) && /[XYZ]-?[\d.]/.test(line)) {
      movingUntil = Math.max(Date.now(), movingUntil) + perMove;
    }
    if (m !== null && Number(m[1]) === 400 && moving()) {
      setTimeout(() => {
        if (!halted) port.emitLine('ok');
      }, movingUntil - Date.now());
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
        movingUntil = 0;
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
  return { ...port, isHalted: () => halted, isMoving: moving };
}
