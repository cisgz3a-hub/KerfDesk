// Audit track MA helper: a small FIFO-faithful model of how Marlin 2.1.2.8
// consumes a serial stream, for repro tests where the repo's Marlin simulator
// is more forgiving than the firmware (it answers every line at once and runs
// queued moves concurrently). Only what the MA repros need is modelled; each
// rule cites the upstream line it follows (all paths under
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/):
//
// - gcode/queue.cpp get_serial_commands(): lines are read into a BUFSIZE (4)
//   ring only while it has room; ';' starts a comment and an empty line is
//   skipped with no reply (process_stream_char / process_line_done); with
//   EMERGENCY_PARSER disabled (stock) M410 and M112 act when the line is READ
//   (L538-L545). Reading also happens inside idle() while a handler blocks
//   (MarlinCore.cpp manage_inactivity -> queue.get_available_commands()).
// - gcode/gcode.cpp process_parsed_command(): commands run strictly in order;
//   `ok` is sent when the handler returns (L1122), and an unknown command
//   still gets `ok` after "echo:Unknown command".
// - module/planner.h get_next_free_block(): a G0/G1 waits in idle() until one
//   of the BLOCK_BUFFER_SIZE (16) planner slots frees, so its `ok` is delayed.
// - gcode/motion/M400.cpp and control/M3-M5.cpp: M400 and M5 call
//   planner.synchronize() before answering; M3 in inline mode synchronizes
//   when LASER_POWER_SYNC is off (stock).
// - gcode/gcode.cpp host_keepalive(): while a handler blocks,
//   "echo:busy: processing" every DEFAULT_KEEPALIVE_INTERVAL (2 s).
// - module/stepper.cpp: in CUTTER_MODE_CONTINUOUS a block applies its power
//   when it starts and nothing blanks the output when the planner runs dry;
//   module/temperature.cpp Temperature::isr() zeroes it after
//   LASER_SAFETY_TIMEOUT_MS (1000 ms stock) without motion.
// - module/motion.cpp quickstop_stepper() / planner.cpp quick_stop(): M410
//   drops every queued block, stops the current one, and discards moves for
//   the next second (cleaning_buffer_counter); the cutter output is untouched.
//   Planner::busy() counts that second, so planner.synchronize() (M400, M5,
//   inline M3, and the queued M410 handler itself: quickstop_stepper() calls
//   quick_stop() then synchronize()) waits until it has passed
//   (planner.cpp L1678-L1705, L1735-L1739, L1803).
// - gcode/gcode.cpp get_destination_from_command(): G0 and G1 share one
//   feedrate (no G0_FEEDRATE in the stock configuration); in continuous mode a
//   G1 S sets the block power and a G0 plans power 0.
// - gcode/host/M114.cpp: M114 reports the projected (planned) position.

import type { PlatformAdapter, SerialConnection } from '../../platform/types';

const BUFSIZE = 4;
const BLOCK_BUFFER_SIZE = 16;
const KEEPALIVE_MS = 2_000;
const LASER_SAFETY_TIMEOUT_MS = 1_000;
const QUICKSTOP_DISCARD_MS = 1_000;
const DEFAULT_FEED_MM_PER_MIN = 4_000;

type Block = {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly durationMs: number;
  readonly power: number;
};

export type BeamInterval = { readonly from: number; readonly to: number; readonly power: number };

export type FifoMarlin = {
  readonly adapter: PlatformAdapter;
  readonly emitLine: (line: string) => void;
  readonly outbound: () => ReadonlyArray<string>;
  /** Milliseconds the cutter output was above zero at or after `since`. */
  readonly beamOnMsSince: (since: number) => number;
  readonly state: () => {
    readonly plannedBlocks: number;
    readonly moving: boolean;
    readonly output: number;
    readonly position: { readonly x: number; readonly y: number };
  };
};

export function createFifoMarlin(options: { readonly responseDelayMs?: number } = {}): FifoMarlin {
  const delay = options.responseDelayMs ?? 1;
  const handlers = new Set<(line: string) => void>();
  const outbound: string[] = [];
  let rxText = '';
  // Each entry is one read command; `started` marks a queued M410 whose handler
  // has already run quickstop_stepper() and now only waits in synchronize().
  const ring: Array<{ readonly command: string; started: boolean }> = [];
  const planner: Block[] = [];
  let executing: { block: Block; startedAt: number; timer: ReturnType<typeof setTimeout> } | null =
    null;
  let handlerBusySince: number | null = null;
  let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  let servicePending = false;
  let killed = false;
  let discardMovesUntil = -1;
  // Laser model (continuous inline only; KerfDesk's inline program uses M3 I).
  let continuous = false;
  let inlinePower = 0;
  let output = 0;
  let outputSince = 0;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  const beam: BeamInterval[] = [];
  let feed = DEFAULT_FEED_MM_PER_MIN;
  let absolute = true;
  let planned = { x: 0, y: 0 };
  let actual = { x: 0, y: 0 };

  const emitLine = (line: string): void => {
    for (const handler of [...handlers]) handler(line);
  };
  const reply = (line: string): void => {
    setTimeout(() => emitLine(line), delay);
  };

  const setOutput = (power: number): void => {
    const now = Date.now();
    if (power === output) return;
    if (output > 0) beam.push({ from: outputSince, to: now, power: output });
    output = power;
    outputSince = now;
  };

  const armSafetyTimeout = (): void => {
    if (safetyTimer !== null) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (executing === null && planner.length === 0) setOutput(0);
    }, LASER_SAFETY_TIMEOUT_MS);
  };

  const startNextBlock = (): void => {
    if (executing !== null) return;
    const block = planner.shift();
    if (block === undefined) {
      armSafetyTimeout();
      return;
    }
    if (continuous) setOutput(block.power);
    const timer = setTimeout(() => {
      actual = block.to;
      executing = null;
      startNextBlock();
      service();
    }, block.durationMs);
    executing = { block, startedAt: Date.now(), timer };
  };

  const quickstop = (): void => {
    planner.splice(0);
    if (executing !== null) {
      clearTimeout(executing.timer);
      const ratio = Math.min(1, (Date.now() - executing.startedAt) / executing.block.durationMs);
      const { from, to } = executing.block;
      actual = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
      executing = null;
    }
    planned = actual;
    discardMovesUntil = Date.now() + QUICKSTOP_DISCARD_MS;
    armSafetyTimeout();
    // A handler waiting in synchronize() resumes when the window closes.
    setTimeout(service, QUICKSTOP_DISCARD_MS);
  };

  const readSerial = (): void => {
    for (;;) {
      if (ring.length >= BUFSIZE) return;
      const newline = rxText.indexOf('\n');
      if (newline < 0) return;
      const raw = rxText.slice(0, newline);
      rxText = rxText.slice(newline + 1);
      const command = (raw.split(';', 1)[0] ?? '').trim();
      if (command === '') continue; // process_line_done(): no ok
      if (/^M410\b/.test(command)) quickstop(); // queue.cpp L543
      if (/^M112\b/.test(command)) {
        killed = true;
        setOutput(0);
        quickstop();
        reply('echo:M112 Shutdown');
        reply('Error:Printer halted. kill() called!');
        return;
      }
      ring.push({ command, started: false });
    }
  };

  const blocked = (): void => {
    if (handlerBusySince === null) handlerBusySince = Date.now();
    if (keepaliveTimer === null) {
      keepaliveTimer = setTimeout(() => {
        keepaliveTimer = null;
        if (handlerBusySince !== null && !killed) {
          reply('echo:busy: processing');
          blocked();
        }
      }, KEEPALIVE_MS);
    }
  };

  const unblocked = (): void => {
    handlerBusySince = null;
    if (keepaliveTimer !== null) clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  };

  const words = (command: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const match of command.matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/gi)) {
      map.set((match[1] ?? '').toUpperCase(), Number(match[2]));
    }
    return map;
  };

  const planMove = (command: string, isG0: boolean): boolean => {
    const w = words(command);
    const f = w.get('F');
    if (f !== undefined && f > 0) feed = f;
    const target = {
      x: w.has('X') ? (absolute ? (w.get('X') ?? 0) : planned.x + (w.get('X') ?? 0)) : planned.x,
      y: w.has('Y') ? (absolute ? (w.get('Y') ?? 0) : planned.y + (w.get('Y') ?? 0)) : planned.y,
    };
    if (continuous) {
      if (isG0) inlinePower = 0;
      else if (w.has('S')) inlinePower = Math.min(255, w.get('S') ?? 0);
    }
    const distance = Math.hypot(target.x - planned.x, target.y - planned.y);
    if (distance === 0) return true;
    if (Date.now() < discardMovesUntil) return true; // cleaning_buffer_counter
    if (planner.length >= BLOCK_BUFFER_SIZE) return false;
    planner.push({
      from: planned,
      to: target,
      durationMs: (distance / feed) * 60_000,
      power: continuous ? inlinePower : 0,
    });
    planned = target;
    startNextBlock();
    return true;
  };

  // Planner::busy(): blocks queued or the quickstop cleaning window running.
  const drained = (): boolean =>
    executing === null && planner.length === 0 && Date.now() >= discardMovesUntil;

  // Returns false while the head command's handler is still blocked.
  const runCommand = (entry: { readonly command: string; started: boolean }): boolean => {
    const code = entry.command.toUpperCase();
    if (/^M410\b/.test(code)) {
      // The queued M410 runs quickstop_stepper() again, then synchronizes.
      if (!entry.started) {
        entry.started = true;
        quickstop();
      }
      if (!drained()) return false;
    } else if (/^G[01](?!\d)/.test(code)) {
      if (!planMove(code, /^G0(?!\d)/.test(code))) return false;
    } else if (/^G90\b/.test(code)) absolute = true;
    else if (/^G91\b/.test(code)) absolute = false;
    else if (/^M400\b/.test(code)) {
      if (!drained()) return false;
    } else if (/^M5\b/.test(code)) {
      if (!drained()) return false;
      setOutput(0);
      if (/\sI\b|\sI$/.test(code)) continuous = false;
      inlinePower = 0;
    } else if (/^M[34]\b/.test(code)) {
      if (/\sI\b|\sI$/.test(code)) {
        continuous = true;
        inlinePower = 0;
      }
      if (continuous && !drained()) return false;
      const s = words(code).get('S');
      if (s !== undefined) inlinePower = s;
    } else if (/^M114\b/.test(code)) {
      reply(`X:${planned.x.toFixed(2)} Y:${planned.y.toFixed(2)} Z:0.00 E:0.00 Count X:0 Y:0 Z:0`);
    }
    reply('ok');
    return true;
  };

  function service(): void {
    if (servicePending || killed) return;
    servicePending = true;
    setTimeout(() => {
      servicePending = false;
      if (killed) return;
      readSerial();
      for (;;) {
        const head = ring[0];
        if (head === undefined) {
          unblocked();
          return;
        }
        if (!runCommand(head)) {
          blocked();
          readSerial(); // idle() -> manage_inactivity() reads while blocked
          return;
        }
        ring.shift();
        unblocked();
        readSerial();
      }
    }, 0);
  }

  const connection: SerialConnection = {
    write: async (data) => {
      outbound.push(data);
      rxText += data;
      // Early M410 is handled on read even while a handler blocks.
      readSerial();
      service();
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };

  return {
    adapter: {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: {
        isSupported: () => true,
        requestPort: async () => ({ open: async () => connection }),
      },
    },
    emitLine,
    outbound: () => [...outbound],
    beamOnMsSince: (since) => {
      const intervals = [
        ...beam,
        ...(output > 0 ? [{ from: outputSince, to: Date.now(), power: output }] : []),
      ];
      return intervals.reduce(
        (total, interval) => total + Math.max(0, interval.to - Math.max(interval.from, since)),
        0,
      );
    },
    state: () => ({
      plannedBlocks: planner.length + (executing === null ? 0 : 1),
      moving: executing !== null,
      output,
      position: actual,
    }),
  };
}
