/* global navigator, window, EventTarget, ReadableStream, WritableStream, TextEncoder, setInterval, setTimeout, performance, queueMicrotask */

// A paced stock GRBL 1.1 for whole-journey specs (after the rolling audit v10
// V9 refuter's simulator). On top of paced-grbl-serial.js it keeps a wire log
// of every line and models what an Abort journey meets:
// - a soft reset during motion answers ALARM:3, the banner and the unlock hint,
//   and a locked controller answers error:9 to G-code;
// - $X unlocks, $H homes to machine zero;
// - G92 and G10 L20 work offsets, which stock GRBL clears at a soft reset;
// - $10: with $10=1 every report carries MPos and WCO:, with $10=0 WPos, and
//   WCO: only on every tenth report;
// - `setWcoReports(false)` withholds WCO: entirely, as a controller whose
//   reports never carried it within a wait.
(function installJourneyGrblSerial() {
  const config = Object.assign(
    { blocksPerSecond: 40, plannerBlocks: 15, tickMs: 4, latencyMs: 2, statusMask: '1' },
    window.__JOURNEY_GRBL_CONFIG__ ?? {},
  );
  const encoder = new TextEncoder();
  const settings = new Map([
    [10, config.statusMask],
    [30, '1000'],
    [31, '0'],
    [32, '1'],
  ]);
  const wire = [];
  let readController = null;
  let partial = '';
  const rxQueue = [];
  const planner = [];
  let credit = 0;
  let lastTick = performance.now();
  let wx = 0; // work position
  let wy = 0;
  let ox = 0; // work offset (WCO)
  let oy = 0;
  let relative = false;
  let held = false;
  let alarm = null;
  let lastMotion = 'Idle';
  let reportCount = 0;
  let wcoReports = true;

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
    if (alarm !== null) return 'Alarm';
    if (held) return 'Hold:0';
    return planner.length > 0 || rxQueue.length > 0 ? lastMotion : 'Idle';
  }
  function status() {
    reportCount += 1;
    const feed = state() === 'Idle' ? 0 : 3000;
    const workOnly = settings.get(10) === '0';
    const withWco = wcoReports && (!workOnly || reportCount % 10 === 0);
    const wco = withWco ? `|WCO:${ox.toFixed(3)},${oy.toFixed(3)},0.000` : '';
    const position = workOnly
      ? `WPos:${wx.toFixed(3)},${wy.toFixed(3)},0.000`
      : `MPos:${(wx + ox).toFixed(3)},${(wy + oy).toFixed(3)},0.000`;
    return `<${state()}|${position}|FS:${feed},0${wco}|Ov:100,100,100>`;
  }
  function execute(line) {
    const upper = line.toUpperCase();
    if (/G91/.test(upper)) relative = true;
    if (/G90/.test(upper)) relative = false;
    const xm = /X(-?[\d.]+)/.exec(upper);
    const ym = /Y(-?[\d.]+)/.exec(upper);
    const rel = upper.startsWith('$J=') ? /G91/.test(upper) : relative;
    if (xm !== null) wx = rel ? wx + Number(xm[1]) : Number(xm[1]);
    if (ym !== null) wy = rel ? wy + Number(ym[1]) : Number(ym[1]);
  }
  function setOffset(upper) {
    const mx = wx + ox;
    const my = wy + oy;
    const xm = /X(-?[\d.]+)/.exec(upper);
    const ym = /Y(-?[\d.]+)/.exec(upper);
    if (xm !== null) {
      ox = mx - Number(xm[1]);
      wx = Number(xm[1]);
    }
    if (ym !== null) {
      oy = my - Number(ym[1]);
      wy = Number(ym[1]);
    }
    // GRBL sends WCO: on the next report after an offset change.
    reportCount = 9;
  }
  function acceptLocked(upper) {
    if (upper === '$X') {
      alarm = null;
      emit('[MSG:Caution: Unlocked]');
    } else if (upper === '$H') {
      alarm = null;
      wx = 0;
      wy = 0;
      ox = 0;
      oy = 0;
    } else if (upper.startsWith('$') || upper === '') {
      if (upper === '$$') for (const [id, value] of settings) emit(`$${id}=${value}`);
      if (upper === '$G') emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    } else {
      emit('error:9');
      return;
    }
    emit('ok');
  }
  function accept(line) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (wire.length < 400000) wire.push(trimmed);
    if (alarm !== null) {
      acceptLocked(upper);
      return;
    }
    if (upper === '$$') {
      for (const [id, value] of settings) emit(`$${id}=${value}`);
    } else if (upper === '$G') {
      emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    } else if (upper === '$H') {
      wx = 0;
      wy = 0;
      ox = 0;
      oy = 0;
    } else {
      const write = /^\$(\d+)=([^\s]+)$/.exec(trimmed);
      if (write !== null) settings.set(Number(write[1]), write[2]);
    }
    if (/G92(?!\.)/.test(upper) || /G10\s*L20/.test(upper)) {
      setOffset(upper);
    } else if (/^\$J=/.test(upper) || /[XY]-?[\d.]/.test(upper)) {
      lastMotion = /^\$J=/.test(upper) ? 'Jog' : 'Run';
      planner.push(trimmed);
    } else if (/G9[01]/.test(upper)) {
      execute(upper);
    }
    emit('ok');
  }
  function admit() {
    while (rxQueue.length > 0 && planner.length < config.plannerBlocks) accept(rxQueue.shift());
  }
  function tick() {
    const now = performance.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (!held && alarm === null && planner.length > 0) {
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
  }
  function reset() {
    const moving = planner.length > 0 || held;
    rxQueue.length = 0;
    planner.length = 0;
    held = false;
    partial = '';
    // Stock GRBL clears G92 at a soft reset; the head stays where it stopped.
    wx += ox;
    wy += oy;
    ox = 0;
    oy = 0;
    reportCount = 9;
    if (moving || alarm !== null) {
      if (moving) emit('ALARM:3');
      alarm = alarm ?? 3;
      emit("Grbl 1.1h ['$' for help]");
      emit("[MSG:'$H'|'$X' to unlock]");
    } else {
      emit("Grbl 1.1h ['$' for help]");
    }
  }
  function receive(text) {
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (character === '?') emit(status());
      else if (character === '!') held = true;
      else if (character === '~') held = false;
      else if (code === 0x18) reset();
      else if (code === 0x85) planner.length = 0;
      else if (code >= 0x80) continue;
      else if (character === '\n') {
        rxQueue.push(partial);
        partial = '';
      } else if (character !== '\r') partial += character;
    }
    admit();
  }

  const port = new EventTarget();
  port.readable = null;
  port.writable = null;
  port.getInfo = () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
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
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        receive(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
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
  const serial = new EventTarget();
  serial.getPorts = async () => [];
  serial.requestPort = async () => port;
  Object.defineProperty(navigator, 'serial', { configurable: true, value: serial });
  setInterval(tick, config.tickMs);
  setTimeout(tick, 0);
  window.__JOURNEY_GRBL__ = {
    wire,
    position: () => ({ wx, wy, ox, oy, mx: wx + ox, my: wy + oy }),
    /** Put the head at machine (x, y), as a hand-moved gantry. */
    place: (x, y) => {
      wx = x - ox;
      wy = y - oy;
    },
    setWcoReports: (on) => {
      wcoReports = on;
    },
  };
})();
