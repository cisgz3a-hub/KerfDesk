/* global navigator, window, EventTarget, ReadableStream, WritableStream, TextEncoder, setInterval, setTimeout, performance, queueMicrotask */

// A paced GRBL 1.1 stand-in for long-running stream measurements. Unlike the
// instant-ack fixture it models a 15-block planner that motion drains at a
// fixed block rate, so acknowledgements arrive at machine pace, status reports
// say Run while blocks remain and MPos follows the executed program. It keeps
// only counters (no per-write event log) so a 300k-line job does not grow the
// page heap on the fixture's behalf.
//
// Writes are read as raw bytes: realtime commands such as the 0x84 safety door
// that KerfDesk's Pause sends are not UTF-8, and a TextDecoder turned them into
// U+FFFD, so no paced run ever paused (rolling audit v10 V8-P2-1). The door
// follows GRBL 1.1: Door:2 while decelerating, Door:0 parked, and after `~`
// Door:3 while restoring, then Run. Laser mode skips the spindle restore delay.
// Every realtime command but `?` is logged with its time in `realtime`; a
// door opened again while restoring decelerates again. `watchLine(source)`
// stamps the first written line that matches a pattern from then on (the
// first beam-on line of a stream, for example), read back by `watchedLine()`.
(function installPacedGrblSerial() {
  const config = Object.assign(
    {
      blocksPerSecond: 500,
      plannerBlocks: 15,
      tickMs: 4,
      latencyMs: 2,
      doorDecelMs: 120,
      doorRestoreMs: 40,
    },
    window.__PACED_GRBL_CONFIG__ ?? {},
  );
  const encoder = new TextEncoder();
  const settings = new Map([
    [30, '1000'],
    [31, '0'],
    [32, '1'],
  ]);
  const stats = { written: 0, acked: 0, executed: 0, statusReplies: 0, simMs: 0 };
  let readController = null;
  let partial = '';
  const rxQueue = [];
  const planner = [];
  let credit = 0;
  let lastTick = performance.now();
  let x = 0;
  let y = 0;
  let held = false;
  let lastMotion = 'Idle';
  // null, or { phase: 'decel' | 'parked' | 'restoring', until }.
  let door = null;
  const realtime = [];
  // null, or { pattern, at, line } once watchLine is called.
  let lineWatch = null;

  // Replies leave in USB-sized batches a couple of milliseconds after the
  // write that caused them, never synchronously inside it.
  let outbox = '';
  let flushTimer = null;
  function flush() {
    flushTimer = null;
    const text = outbox;
    outbox = '';
    if (text.length > 0) readController?.enqueue(encoder.encode(text));
  }
  function emit(line) {
    outbox += `${line}\n`;
    if (flushTimer === null) flushTimer = setTimeout(flush, config.latencyMs);
  }
  function state() {
    if (door !== null) {
      return door.phase === 'decel' ? 'Door:2' : door.phase === 'parked' ? 'Door:0' : 'Door:3';
    }
    if (held) return 'Hold:0';
    return planner.length > 0 || rxQueue.length > 0 ? lastMotion : 'Idle';
  }
  function status() {
    stats.statusReplies += 1;
    const feed = state() === 'Idle' ? 0 : 3000;
    return `<${state()}|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|FS:${feed},0|WCO:0.000,0.000,0.000|Ov:100,100,100>`;
  }
  function execute(line) {
    const xm = /X(-?[\d.]+)/.exec(line);
    const ym = /Y(-?[\d.]+)/.exec(line);
    if (xm !== null) x = Number(xm[1]);
    if (ym !== null) y = Number(ym[1]);
    stats.executed += 1;
  }
  function accept(line) {
    // A line enters the planner and is acknowledged at admission, as GRBL does.
    const trimmed = line.trim();
    if (trimmed === '$$') {
      for (const [id, value] of settings) emit(`$${id}=${value}`);
    } else {
      const write = /^\$(\d+)=([^\s]+)$/.exec(trimmed);
      if (write !== null) settings.set(Number(write[1]), write[2]);
    }
    const motion = /^\$J=/.test(trimmed) || /[XY]-?[\d.]/.test(trimmed);
    if (motion) {
      lastMotion = /^\$J=/.test(trimmed) ? 'Jog' : 'Run';
      planner.push(trimmed);
    }
    stats.acked += 1;
    emit('ok');
  }
  function admit() {
    while (rxQueue.length > 0 && planner.length < config.plannerBlocks) accept(rxQueue.shift());
  }
  function tick() {
    const started = performance.now();
    const elapsed = started - lastTick;
    lastTick = started;
    if (door !== null && started >= door.until) {
      if (door.phase === 'decel') {
        door = { phase: 'parked', until: Infinity };
      } else if (door.phase === 'restoring') {
        door = null;
        held = false;
      }
    }
    if (!held && planner.length > 0) {
      credit += (elapsed / 1000) * config.blocksPerSecond;
      while (credit >= 1 && planner.length > 0) {
        execute(planner.shift());
        credit -= 1;
      }
      if (planner.length === 0) credit = 0;
    } else {
      credit = 0;
    }
    admit();
    stats.simMs += performance.now() - started;
  }
  function logRealtime(code) {
    realtime.push({ byte: code, t: performance.now() });
  }
  function receive(bytes) {
    for (const code of bytes) {
      const character = String.fromCharCode(code);
      if (character === '?') {
        emit(status());
      } else if (character === '!') {
        logRealtime(code);
        held = true;
      } else if (code === 0x84) {
        logRealtime(code);
        held = true;
        if (door === null || door.phase === 'restoring') {
          door = { phase: 'decel', until: performance.now() + config.doorDecelMs };
        }
      } else if (character === '~') {
        logRealtime(code);
        if (door === null) held = false;
        else if (door.phase === 'parked') {
          door = { phase: 'restoring', until: performance.now() + config.doorRestoreMs };
        }
      } else if (code === 0x18) {
        logRealtime(code);
        door = null;
        rxQueue.length = 0;
        planner.length = 0;
        held = false;
        partial = '';
        emit("Grbl 1.1h ['$' for help]");
      } else if (code === 0x85) {
        logRealtime(code);
        planner.length = 0;
      } else if (code >= 0x80) {
        // Other realtime overrides need no reply.
        logRealtime(code);
      } else if (character === '\n') {
        stats.written += 1;
        if (lineWatch !== null && lineWatch.at === null && lineWatch.pattern.test(partial)) {
          lineWatch.at = performance.now();
          lineWatch.line = partial;
        }
        rxQueue.push(partial);
        partial = '';
      } else if (character !== '\r') {
        partial += character;
      }
    }
    admit();
  }

  const port = new EventTarget();
  port.readable = null;
  port.writable = null;
  port.getInfo = () => ({});
  port.open = async () => {
    port.readable = new ReadableStream({
      start(controller) {
        readController = controller;
      },
      cancel() {
        readController = null;
      },
    });
    port.writable = new WritableStream({
      write(chunk) {
        receive(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      },
    });
    queueMicrotask(() => {
      emit("Grbl 1.1h ['$' for help]");
      emit(status());
    });
  };
  port.close = async () => {
    readController = null;
    port.readable = null;
    port.writable = null;
  };
  port.forget = async () => undefined;
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { getPorts: async () => [], requestPort: async () => port },
  });
  setInterval(tick, config.tickMs);
  setTimeout(tick, 0);
  function watchLine(source) {
    lineWatch = { pattern: new RegExp(source), at: null, line: null };
  }
  window.__PACED_GRBL__ = {
    stats,
    config,
    emit,
    realtime,
    status: () => status(),
    state,
    watchLine,
    watchedLine: () => lineWatch,
  };
})();
