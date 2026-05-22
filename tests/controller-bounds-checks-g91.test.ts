/**
 * T1-44: GrblController._checkJobBounds simulates G91 (relative mode) from
 * the controller's last-confirmed head position. Pre-T1-44 the relative
 * branch was a no-op — current/head-mode jobs (entire body in G91) got
 * zero bounds protection at the controller layer. Now the simulated
 * cursor is seeded from `_state.position` (set by the most recent
 * status report) and the relative deltas accumulate; positions outside
 * the bed envelope reject.
 *
 * Refusal also fires when a relative move is reached and no status
 * report has populated `_state.position` yet — the constructor default
 * `{0,0,0}` is indistinguishable from "actually at origin" and a wrong
 * assumption could place the head off-bed.
 *
 * Run: npx tsx tests/controller-bounds-checks-g91.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function port400x300(): MockSerialPort {
  return new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0', '$22=0', '$23=0', '$32=0', '$30=1000.000',
        '$110=10000.000', '$111=10000.000',
        '$120=10.000', '$121=10.000',
        '$130=400.000', '$131=300.000',
        'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    if (/^G|^M|^S|^F/.test(line)) return ['ok'];
    return ['ok'];
  });
}

console.log('\n=== T1-44 _checkJobBounds simulates G91 ===\n');

async function run(): Promise<void> {

// ── 1. G91 G0 X100 from confirmed (0,0) → within bed → accept ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X100 Y50', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err === null, `G91 G0 X100 Y50 from (0,0) within bed → accept (got: ${err})`);
  if (ctrl.isJobRunning) {
    while (ctrl.isJobRunning) { port.injectResponse('ok'); await flush(2); }
  }
  await ctrl.disconnect();
}

// ── 2. G91 G0 X+500 from (0,0) → exceeds 400mm bed → reject with X-axis msg ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X500', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'G91 G0 X500 from (0,0) → reject (500 > 400)');
  assert(/X=500/.test(err ?? ''), 'reject error mentions accumulated X position (500)');
  assert(/400/.test(err ?? ''), 'reject error mentions bed width (400)');
  await ctrl.disconnect();
}

// ── 3. G91 with two deltas accumulating past edge → reject on second ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X300', 'G0 X150', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'G91 deltas 300 + 150 = 450 > 400 → reject');
  assert(/X=450/.test(err ?? ''), 'reject error mentions cumulative X position (450)');
  await ctrl.disconnect();
}

// ── 4. G91 → G90 → absolute G0 X500 → reject on absolute (mode-flip works) ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X100', 'G90', 'G0 X500', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'G91 → G90 → G0 X500 → reject (mode flip preserves bounds checking)');
  assert(/X=500/.test(err ?? ''), 'reject error reports the absolute position that exceeded');
  await ctrl.disconnect();
}

// ── 5. Negative-delta G91 from origin → off-bed (X negative) → reject ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X-50', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'G91 G0 X-50 from (0,0) → reject (negative X)');
  assert(/X=-50/.test(err ?? ''), 'reject error reports negative X');
  await ctrl.disconnect();
}

// ── 6. G91 lines but no status report yet → "position unknown" reject ──
//      Bypassing the normal welcome flow by injecting only the bare GRBL
//      banner without any <...> status, so _positionConfirmed stays false.
{
  // Custom port: respond to $$ for connect handshake but block any `?`
  // status response so _positionConfirmed never gets set.
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0', '$22=0', '$23=0', '$32=0', '$30=1000.000',
        '$110=10000.000', '$111=10000.000',
        '$120=10.000', '$121=10.000',
        '$130=400.000', '$131=300.000',
        'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    return ['ok'];
  });
  port.blockStatusQueryResponse = true;  // suppress the auto-injected `<Idle|...>` reply
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  // Force `_queryFreshStatus` inside sendJob to return 'idle' even though
  // no real status came: the controller's status field stays at whatever
  // the welcome path decided. With banner-only welcome it stays 'idle'
  // (the welcome handler defaults to 'idle' when no status token in
  // the welcome line — see GrblController.connect line ~308).
  // What matters for T1-44: _positionConfirmed remained false, so the
  // relative move must be refused.
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91', 'G0 X100', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  // The exact error depends on whether _queryFreshStatus times out first
  // or the bounds check fires; either way the job MUST be rejected. The
  // bounds-side message contains "position is unknown" and "Reconnect".
  assert(err != null, 'G91 with no confirmed status → reject');
  // Belt-and-suspenders: in production paths where status DOES arrive,
  // the position-unknown message is the T1-44 contract. Test only the
  // non-acceptance contract here to stay robust to the timing.
  await ctrl.disconnect();
}

// ── 7. Same-block G91 + motion must still simulate and reject ──
{
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G91 G0 X9999', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'same-block G91 G0 X9999 → reject (mode word plus motion is not skipped)');
  assert(/X=9999/.test(err ?? ''), 'same-block relative rejection reports accumulated X position');
  await ctrl.disconnect();
}

// -------- 8. Malformed status coordinates must not confirm position --------
{
  const ctrl = new GrblController();
  const priv = ctrl as unknown as {
    _positionConfirmed: boolean;
    _handleStatusReport: (raw: string) => void;
  };
  priv._positionConfirmed = false;
  priv._handleStatusReport('<Idle|MPos:bad,20,0|FS:0,0>');
  assert(
    Boolean(priv._positionConfirmed) === false,
    'malformed MPos status does not mark controller position confirmed',
  );
  priv._handleStatusReport('<Idle|WPos:10,20,0|FS:0,0>');
  assert(
    Boolean(priv._positionConfirmed) === true,
    'valid WPos status still marks controller position confirmed',
  );
}

// ── 9. Source-level pin: _positionConfirmed flag + simulation shape ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );

  assert(/T1-44/.test(src), 'T1-44 marker present in GrblController.ts');
  assert(/private _positionConfirmed = false/.test(src),
    '_positionConfirmed flag declared on the controller');
  assert(/this\._positionConfirmed = true; \/\/ T1-44/.test(src),
    'flag set true when wPos / mPos parsed in status report (T1-44 markers)');
  assert(/this\._positionConfirmed = false/.test(src),
    'flag cleared on disconnect / connect-entry');

  // Find the _checkJobBounds wrapper and pin the delegated simulation shape.
  const start = src.indexOf('private _checkJobBounds(');
  const end = src.indexOf('private _queryFreshStatus', start);
  const body = src.slice(start, end);
  assert(body.length > 200, 'located _checkJobBounds body');
  assert(/checkGrblJobBounds\(lines,\s*this\._jobBoundsContext\(\)\)/.test(body),
    '_checkJobBounds delegates to checkGrblJobBounds');
  assert(/headPosition:\s*\{\s*x:\s*this\._state\.position\.x,\s*y:\s*this\._state\.position\.y\s*\}/.test(body),
    '_checkJobBounds passes _state.position to the helper');
  assert(/positionConfirmed:\s*this\._positionConfirmed/.test(body),
    '_checkJobBounds passes _positionConfirmed to the helper');

  const helperSrc = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblJobBoundsChecker.ts'),
    'utf-8',
  );
  assert(/curX:\s*ctx\.headPosition\.x/.test(helperSrc),
    'helper seeds curX from headPosition.x');
  assert(/curY:\s*ctx\.headPosition\.y/.test(helperSrc),
    'helper seeds curY from headPosition.y');
  assert(/if \(!ctx\.positionConfirmed\)/.test(helperSrc),
    'helper refuses relative moves when positionConfirmed is false');
  assert(/Cannot accept relative-mode job/.test(helperSrc),
    'position-unknown message phrasing matches contract');
  assert(/Reconnect to refresh status/.test(helperSrc),
    'position-unknown message names "Reconnect" remediation');
  assert(/state\.curX \+= parseFloat\(xMatch\[1\]\)/.test(helperSrc),
    'helper relative branch accumulates X delta');
  assert(/state\.curY \+= parseFloat\(yMatch\[1\]\)/.test(helperSrc),
    'helper relative branch accumulates Y delta');
  // The OLD `if (relative) continue` short-circuit must be gone.
  assert(!/if \(relative\) continue;/.test(helperSrc),
    'OLD `if (relative) continue` short-circuit removed');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
