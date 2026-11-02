// marlin-fifo-model — a small time-faithful model of how Marlin 2.1.2.8
// consumes a serial stream and drives a continuous-mode laser, for tests that
// need feed-based move times and the beam's on/off timeline (the scripted
// marlin-simulator.ts runs every move in a fixed time and records burns by
// order). Promoted from the 2026-09-25 controller audit (track MA). Each rule
// cites the upstream line it follows (paths under
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/):
//
// - gcode/queue.cpp get_serial_commands(): lines are read into a BUFSIZE (4)
//   ring only while it has room; ';' starts a comment and an empty line is
//   skipped with no reply (process_stream_char / process_line_done); with
//   EMERGENCY_PARSER disabled (stock) M410 and M112 act when the line is READ
//   (L538-L545). Reading also happens inside idle() while a handler blocks
//   (MarlinCore.cpp manage_inactivity -> queue.get_available_commands()).
// - gcode/gcode.cpp process_parsed_command(): commands run strictly in order;
//   `ok` is sent when the handler returns (L1122).
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
// - gcode/parser.cpp parse() L266 and gcode/gcode.cpp L1119-L1122: a line
//   whose first letter is not G, M or T sets no command, so Marlin echoes
//   `Unknown command: "<the text it read>"` (parser.cpp L390-L392), skips it
//   and answers `ok`. Over serial a line without `N` has no checksum
//   (queue.cpp L473-L510), so a command letter lost on the wire lands here.
// - gcode/temp/M106_M107.cpp and planner.cpp check_axes_activity()
//   (L1388-L1399): M106 S (255 without S) and M107 set the fan speed when they
//   run, and each block keeps the speed current when it was planned. The fan
//   output follows the running block, and the current speed once the planner
//   is empty; nothing times it out (rolling audit v6 K1-P1-1).
// - planner.cpp synchronize() loops in idle() until Planner::busy() clears, so
//   a handler held by the quickstop's cleaning window is always released when
//   it ends. Here that is a wake-up re-armed each time the handler is found
//   still blocked with no motion left to wake it. `Date.now()` reads the wall
//   clock and timers the monotonic one, so a single wake-up can land just short
//   of the deadline, and a second one is dropped while a service hop is pending
//   (rolling audit v9 R1-P3-2: 123 hangs in 18,000 trials, 0 in 12,000 re-armed).

import type { PlatformAdapter, SerialConnection } from '../../platform/types';

const BUFSIZE = 4;
const BLOCK_BUFFER_SIZE = 16;
const KEEPALIVE_MS = 2_000;
const LASER_SAFETY_TIMEOUT_MS = 1_000;
const QUICKSTOP_DISCARD_MS = 1_000;
const DEFAULT_FEED_MM_PER_MIN = 4_000;

type Point = { readonly x: number; readonly y: number };

type Block = {
  readonly from: Point;
  readonly to: Point;
  readonly durationMs: number;
  readonly power: number;
  /** The fan speed current when the block was planned. */
  readonly fan: number;
};

type RingEntry = { readonly command: string; started: boolean };

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
    /** The fan output now: the running block's speed, else the current one. */
    readonly fan: number;
    readonly position: Point;
    /** The commands read but not finished, oldest first. */
    readonly ring: ReadonlyArray<string>;
    /** Milliseconds left of the quickstop's cleaning window; negative when over. */
    readonly discardIn: number;
  };
};

type Machine = {
  ring: RingEntry[];
  planner: Block[];
  executing: { block: Block; startedAt: number; timer: ReturnType<typeof setTimeout> } | null;
  handlerBusySince: number | null;
  keepaliveTimer: ReturnType<typeof setTimeout> | null;
  servicePending: boolean;
  drainWake: ReturnType<typeof setTimeout> | null;
  killed: boolean;
  discardMovesUntil: number;
  continuous: boolean;
  inlinePower: number;
  output: number;
  outputSince: number;
  safetyTimer: ReturnType<typeof setTimeout> | null;
  beam: BeamInterval[];
  fan: number;
  feed: number;
  absolute: boolean;
  planned: Point;
  actual: Point;
  rxText: string;
};

function newMachine(): Machine {
  return {
    ring: [],
    planner: [],
    executing: null,
    handlerBusySince: null,
    keepaliveTimer: null,
    servicePending: false,
    drainWake: null,
    killed: false,
    discardMovesUntil: -1,
    continuous: false,
    inlinePower: 0,
    output: 0,
    outputSince: 0,
    safetyTimer: null,
    beam: [],
    fan: 0,
    feed: DEFAULT_FEED_MM_PER_MIN,
    absolute: true,
    planned: { x: 0, y: 0 },
    actual: { x: 0, y: 0 },
    rxText: '',
  };
}

function words(command: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const match of command.matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/gi)) {
    map.set((match[1] ?? '').toUpperCase(), Number(match[2]));
  }
  return map;
}

function hasInlineFlag(code: string): boolean {
  return /\sI\b|\sI$/.test(code);
}

export function createFifoMarlin(options: { readonly responseDelayMs?: number } = {}): FifoMarlin {
  const delay = options.responseDelayMs ?? 1;
  const handlers = new Set<(line: string) => void>();
  const outbound: string[] = [];
  const m = newMachine();

  const emitLine = (line: string): void => {
    for (const handler of [...handlers]) handler(line);
  };
  const reply = (line: string): void => {
    setTimeout(() => emitLine(line), delay);
  };

  const setOutput = (power: number): void => {
    const now = Date.now();
    if (power === m.output) return;
    if (m.output > 0) m.beam.push({ from: m.outputSince, to: now, power: m.output });
    m.output = power;
    m.outputSince = now;
  };

  const armSafetyTimeout = (): void => {
    if (m.safetyTimer !== null) clearTimeout(m.safetyTimer);
    m.safetyTimer = setTimeout(() => {
      m.safetyTimer = null;
      if (m.executing === null && m.planner.length === 0) setOutput(0);
    }, LASER_SAFETY_TIMEOUT_MS);
  };

  const startNextBlock = (): void => {
    if (m.executing !== null) return;
    const block = m.planner.shift();
    if (block === undefined) {
      armSafetyTimeout();
      return;
    }
    if (m.continuous) setOutput(block.power);
    const timer = setTimeout(() => {
      m.actual = block.to;
      m.executing = null;
      startNextBlock();
      service();
    }, block.durationMs);
    m.executing = { block, startedAt: Date.now(), timer };
  };

  const quickstop = (): void => {
    m.planner.splice(0);
    if (m.executing !== null) {
      clearTimeout(m.executing.timer);
      const ratio = Math.min(
        1,
        (Date.now() - m.executing.startedAt) / m.executing.block.durationMs,
      );
      const { from, to } = m.executing.block;
      m.actual = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
      m.executing = null;
    }
    m.planned = m.actual;
    m.discardMovesUntil = Date.now() + QUICKSTOP_DISCARD_MS;
    armSafetyTimeout();
    // A handler waiting in synchronize() resumes when the window closes.
    setTimeout(service, QUICKSTOP_DISCARD_MS);
  };

  const kill = (): void => {
    m.killed = true;
    setOutput(0);
    quickstop();
    reply('echo:M112 Shutdown');
    reply('Error:Printer halted. kill() called!');
  };

  const readSerial = (): void => {
    while (m.ring.length < BUFSIZE) {
      const newline = m.rxText.indexOf('\n');
      if (newline < 0) return;
      const raw = m.rxText.slice(0, newline);
      m.rxText = m.rxText.slice(newline + 1);
      const command = (raw.split(';', 1)[0] ?? '').trim();
      if (command === '') continue; // process_line_done(): no ok
      if (/^M410\b/.test(command)) quickstop(); // queue.cpp L543
      if (/^M112\b/.test(command)) {
        kill();
        return;
      }
      m.ring.push({ command, started: false });
    }
  };

  const blocked = (): void => {
    if (m.handlerBusySince === null) m.handlerBusySince = Date.now();
    if (m.keepaliveTimer !== null) return;
    m.keepaliveTimer = setTimeout(() => {
      m.keepaliveTimer = null;
      if (m.handlerBusySince !== null && !m.killed) {
        reply('echo:busy: processing');
        blocked();
      }
    }, KEEPALIVE_MS);
  };

  const unblocked = (): void => {
    m.handlerBusySince = null;
    if (m.keepaliveTimer !== null) clearTimeout(m.keepaliveTimer);
    m.keepaliveTimer = null;
  };

  const target = (w: Map<string, number>, axis: 'X' | 'Y'): number => {
    const current = axis === 'X' ? m.planned.x : m.planned.y;
    const value = w.get(axis);
    if (value === undefined) return current;
    return m.absolute ? value : current + value;
  };

  const planMove = (command: string, isG0: boolean): boolean => {
    const w = words(command);
    const f = w.get('F');
    if (f !== undefined && f > 0) m.feed = f;
    const to = { x: target(w, 'X'), y: target(w, 'Y') };
    if (m.continuous) {
      if (isG0) m.inlinePower = 0;
      else if (w.has('S')) m.inlinePower = Math.min(255, w.get('S') ?? 0);
    }
    const distance = Math.hypot(to.x - m.planned.x, to.y - m.planned.y);
    if (distance === 0) return true;
    if (Date.now() < m.discardMovesUntil) return true; // cleaning_buffer_counter
    if (m.planner.length >= BLOCK_BUFFER_SIZE) return false;
    m.planner.push({
      from: m.planned,
      to,
      durationMs: (distance / m.feed) * 60_000,
      power: m.continuous ? m.inlinePower : 0,
      fan: m.fan,
    });
    m.planned = to;
    startNextBlock();
    return true;
  };

  // Planner::busy(): blocks queued or the quickstop cleaning window running.
  const drained = (): boolean =>
    m.executing === null && m.planner.length === 0 && Date.now() >= m.discardMovesUntil;

  const runM5 = (code: string): boolean => {
    if (!drained()) return false;
    setOutput(0);
    if (hasInlineFlag(code)) m.continuous = false;
    m.inlinePower = 0;
    return true;
  };

  const runM3 = (code: string): boolean => {
    if (hasInlineFlag(code)) {
      m.continuous = true;
      m.inlinePower = 0;
    }
    if (m.continuous && !drained()) return false;
    const s = words(code).get('S');
    if (s !== undefined) m.inlinePower = s;
    return true;
  };

  // The queued M410 runs quickstop_stepper() again, then synchronizes.
  const runM410 = (entry: RingEntry): boolean => {
    if (!entry.started) {
      entry.started = true;
      quickstop();
    }
    return drained();
  };

  const runMCode = (entry: RingEntry, code: string): boolean => {
    if (/^M410\b/.test(code)) return runM410(entry);
    if (/^M400\b/.test(code)) return drained();
    if (/^M106\b/.test(code)) {
      m.fan = Math.min(255, words(code).get('S') ?? 255);
      return true;
    }
    if (/^M107\b/.test(code)) {
      m.fan = 0;
      return true;
    }
    if (/^M5\b/.test(code)) return runM5(code);
    if (/^M[34]\b/.test(code)) return runM3(code);
    if (/^M114\b/.test(code)) {
      reply(
        `X:${m.planned.x.toFixed(2)} Y:${m.planned.y.toFixed(2)} Z:0.00 E:0.00 Count X:0 Y:0 Z:0`,
      );
    }
    return true;
  };

  const runGCode = (code: string): boolean => {
    if (/^G[01](?!\d)/.test(code)) return planMove(code, /^G0(?!\d)/.test(code));
    if (/^G90\b/.test(code)) m.absolute = true;
    else if (/^G91\b/.test(code)) m.absolute = false;
    return true;
  };

  // Returns false while the head command's handler is still blocked.
  const runCommand = (entry: RingEntry): boolean => {
    const code = entry.command.toUpperCase();
    if (!/^[GMT]/.test(code)) {
      reply(`echo:Unknown command: "${entry.command}"`);
      reply('ok');
      return true;
    }
    const done = code.startsWith('M') ? runMCode(entry, code) : runGCode(code);
    if (done) reply('ok');
    return done;
  };

  function service(): void {
    if (m.servicePending || m.killed) return;
    m.servicePending = true;
    setTimeout(() => {
      m.servicePending = false;
      if (m.killed) return;
      runRing();
    }, 0);
  }

  // A handler blocked with nothing moving waits only on the clock, so nothing
  // else will wake it: poll, as idle() does.
  function rearmDrainWake(): void {
    if (m.executing !== null || m.planner.length > 0 || m.drainWake !== null) return;
    const remaining = Math.max(0, m.discardMovesUntil - Date.now());
    m.drainWake = setTimeout(() => {
      m.drainWake = null;
      service();
    }, remaining + 1);
  }

  function runRing(): void {
    readSerial();
    for (let head = m.ring[0]; head !== undefined; head = m.ring[0]) {
      if (!runCommand(head)) {
        blocked();
        readSerial(); // idle() -> manage_inactivity() reads while blocked
        rearmDrainWake();
        return;
      }
      m.ring.shift();
      unblocked();
      readSerial();
    }
    unblocked();
  }

  const connection: SerialConnection = {
    write: async (data) => {
      outbound.push(data);
      m.rxText += data;
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
        ...m.beam,
        ...(m.output > 0 ? [{ from: m.outputSince, to: Date.now(), power: m.output }] : []),
      ];
      return intervals.reduce(
        (total, interval) => total + Math.max(0, interval.to - Math.max(interval.from, since)),
        0,
      );
    },
    state: () => ({
      plannedBlocks: m.planner.length + (m.executing === null ? 0 : 1),
      moving: m.executing !== null,
      output: m.output,
      fan: m.executing === null ? m.fan : m.executing.block.fan,
      position: m.actual,
      ring: m.ring.map((entry) => entry.command),
      discardIn: m.discardMovesUntil - Date.now(),
    }),
  };
}
