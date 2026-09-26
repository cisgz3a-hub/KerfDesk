// marlin-sim-queue — the part of Marlin 2.1.2.8 that decides WHEN the host
// hears back, for marlin-simulator.ts. Paths are under
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/ :
//  - gcode/queue.cpp get_serial_commands(): a line is read into the BUFSIZE (4)
//    command ring only while the ring has room (L443-L558); `;` starts a
//    comment and a line left empty gets no reply (L369-L372, L396-L405,
//    L466-L468); M410 and M112 act when the line is READ (L538-L545).
//  - gcode/gcode.cpp process_next_command(): commands run strictly in order
//    and `ok` is sent when the handler returns (L1122), also after an
//    `Error:` a handler printed and after `echo:Unknown command: "..."` for a
//    command whose build option is off (L489-L505, L591-L594, L1101-L1122).
//  - module/planner.h get_next_free_block(): a G0/G1 waits for a free planner
//    slot (L774-L777). The ring keeps one of its BLOCK_BUFFER_SIZE (16) slots
//    free, so it holds 15 moves, the busy one included (moves_free(), L752,
//    L765). Planned moves run one after another in the stepper ISR.
//  - Planner::synchronize() (planner.cpp L1803): M400, M3/M4 (M3-M5.cpp L81,
//    L111), M5 (L143), M7/M8/M9 (M7-M9.cpp), G4 and G28 wait for the planner
//    to drain before they answer.
//  - planner.cpp quick_stop() (L1678-L1705): M410 drops every planned move and
//    refuses moves for one second; the queued M410 then waits that second out.
//  - gcode.cpp host_keepalive() (L1204-L1229): `echo:busy: processing` every
//    DEFAULT_KEEPALIVE_INTERVAL (2 s, Configuration.h L2228-L2229) while a
//    handler waits.

export const MARLIN_BUFSIZE = 4;
export const MARLIN_BLOCK_BUFFER_SIZE = 16;
/** Moves the planner holds at once: BLOCK_BUFFER_SIZE - 1 (planner.h L765). */
export const MARLIN_PLANNER_MOVES = MARLIN_BLOCK_BUFFER_SIZE - 1;
export const MARLIN_KEEPALIVE_MS = 2_000;
export const MARLIN_QUICKSTOP_MS = 1_000;

export type MarlinSimBlock = {
  /** Called when the move starts to execute. */
  readonly onStart: () => void;
  /** Called when it has run to its end. */
  readonly onFinish: () => void;
};

/** A command handler: true once it has answered, false while it waits. */
export type MarlinSimHandler = (line: string, firstRun: boolean) => boolean;

export type MarlinSimQueueOptions = {
  readonly motionMs: number;
  readonly keepaliveMs: number;
  readonly plannerBlocks: number;
  readonly emit: (line: string) => void;
  /** Runs one command; `firstRun` is false when it is retried after waiting. */
  readonly run: MarlinSimHandler;
  /** Acts on a line when Marlin reads it (M410, M112); false drops the line. */
  readonly onRead: (line: string) => boolean;
};

export type MarlinSimQueue = {
  readonly receive: (data: string) => void;
  readonly plan: (block: MarlinSimBlock) => void;
  readonly plannerFull: () => boolean;
  readonly drained: () => boolean;
  readonly discarding: () => boolean;
  readonly quickStop: () => void;
  /** Re-run the waiting command after `ms` (a dwell or homing cycle). */
  readonly retryAfter: (ms: number) => void;
  readonly pendingMotions: () => number;
  readonly reset: () => void;
  readonly halt: () => void;
};

type RingEntry = { readonly line: string; started: boolean };

export function createMarlinSimQueue(options: MarlinSimQueueOptions): MarlinSimQueue {
  const serialLines: string[] = [];
  const ring: RingEntry[] = [];
  const blocks: MarlinSimBlock[] = [];
  let partial = '';
  let executing: {
    readonly block: MarlinSimBlock;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let discardUntil = -1;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let halted = false;
  let servicing = false;

  const stopKeepalive = (): void => {
    if (keepalive !== null) clearInterval(keepalive);
    keepalive = null;
  };
  const startKeepalive = (): void => {
    if (options.keepaliveMs <= 0 || keepalive !== null) return;
    keepalive = setInterval(() => options.emit('echo:busy: processing'), options.keepaliveMs);
  };

  const readSerial = (): void => {
    while (!halted && ring.length < MARLIN_BUFSIZE && serialLines.length > 0) {
      const line = (serialLines.shift() ?? '').replace(/;.*$/, '').trim();
      if (line === '') continue; // process_line_done(): nothing is answered
      if (options.onRead(line)) ring.push({ line, started: false });
    }
  };

  const service = (): void => {
    if (servicing) return;
    servicing = true;
    try {
      for (let head = ring[0]; head !== undefined && !halted; head = ring[0]) {
        const firstRun = !head.started;
        head.started = true;
        if (!options.run(head.line, firstRun)) {
          startKeepalive();
          return;
        }
        ring.shift();
        stopKeepalive();
        readSerial();
      }
      stopKeepalive();
    } finally {
      servicing = false;
    }
  };

  const startNextBlock = (): void => {
    if (executing !== null || halted) return;
    const block = blocks.shift();
    if (block === undefined) return;
    block.onStart();
    const timer = setTimeout(() => {
      executing = null;
      block.onFinish();
      startNextBlock();
      service();
    }, options.motionMs);
    executing = { block, timer };
  };

  const clearPlanner = (): void => {
    blocks.splice(0);
    if (executing !== null) clearTimeout(executing.timer);
    executing = null;
  };

  return {
    receive: (data) => {
      for (const ch of data) {
        if (ch === '\n') {
          serialLines.push(partial);
          partial = '';
        } else if (ch !== '\r') partial += ch;
      }
      readSerial();
      service();
    },
    plan: (block) => {
      blocks.push(block);
      startNextBlock();
    },
    plannerFull: () => blocks.length + (executing === null ? 0 : 1) >= options.plannerBlocks,
    drained: () => executing === null && blocks.length === 0 && Date.now() >= discardUntil,
    discarding: () => Date.now() < discardUntil,
    quickStop: () => {
      clearPlanner();
      discardUntil = Date.now() + MARLIN_QUICKSTOP_MS;
      setTimeout(service, MARLIN_QUICKSTOP_MS);
    },
    retryAfter: (ms) => {
      setTimeout(service, ms);
    },
    pendingMotions: () => blocks.length + (executing === null ? 0 : 1),
    reset: () => {
      serialLines.splice(0);
      ring.splice(0);
      partial = '';
      halted = false;
      stopKeepalive();
    },
    halt: () => {
      halted = true;
      clearPlanner();
      serialLines.splice(0);
      ring.splice(0);
      stopKeepalive();
    },
  };
}
