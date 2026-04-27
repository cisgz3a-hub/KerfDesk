/**
 * T1-94 regression test: Falcon WebSocket frame and buffer caps.
 *
 * Bug: electron/falcon-wifi/FalconWebSocket.ts:190 only rejected frames
 * larger than ~9 petabytes (BigInt(Number.MAX_SAFE_INTEGER)). A malicious
 * local-network actor (compromised router, ARP spoofing, fake Falcon
 * device) could send a frame header claiming a 1 GB length; the check
 * passed; the frame parser then waited for the rest of the data while
 * state.buffer grew unbounded as more chunks arrived, OOMing the
 * renderer.
 *
 * A second attack shape: send many small chunks that never form a
 * complete frame. state.buffer = Buffer.concat([state.buffer, chunk])
 * grew on each chunk with no upper bound.
 *
 * Fix: practical caps on per-frame size (256 KB) and total buffer (1 MB).
 * The Falcon protocol uses small JSON messages (typically a few hundred
 * bytes), so legitimate traffic is always far below either threshold.
 * Violations destroy the socket and trigger reconnect — persistent
 * attackers continue to disconnect rather than accumulating memory.
 *
 * This test mirrors the cap rules in pure logic (so divergence between
 * test and production code surfaces as a test failure) AND grep-asserts
 * that the production file uses the constants in the right code paths
 * (so a refactor that drops one of the caps fails CI).
 *
 * Run: npx tsx tests/falcon-ws-frame-cap.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROD_FILE = join(REPO_ROOT, 'electron', 'falcon-wifi', 'FalconWebSocket.ts');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== falcon ws frame + buffer caps (T1-94) ===\n');

// Pure-logic mirror of the production caps. If anyone changes the
// production constants, these mirrors will diverge and the test must
// be updated alongside — that's the point.
const MAX_WS_FRAME_BYTES = 256 * 1024;
const MAX_WS_BUFFER_BYTES = 1024 * 1024;

/**
 * Mirror of the frame-length check from FalconWebSocket.ts. Returns true
 * if a frame of the given declared length should be rejected.
 */
function frameRejected(len: number): boolean {
  return len > MAX_WS_FRAME_BYTES;
}

/**
 * Mirror of the buffer-overflow check at the data event handler. Returns
 * true if appending a chunk of `chunkLen` bytes to a buffer that already
 * holds `bufLen` bytes would exceed the cap.
 */
function bufferOverflow(bufLen: number, chunkLen: number): boolean {
  return bufLen + chunkLen > MAX_WS_BUFFER_BYTES;
}

// ── BEHAVIOR: 16-bit frame length path ──────────────────────────────
{
  // 7-bit length encoding maxes at 125 — always under cap, never tested.
  // 16-bit length (when first byte == 126) ranges 126..65535.
  assert(!frameRejected(126), '16-bit minimum (126) accepted');
  assert(!frameRejected(65535), '16-bit maximum (65535) accepted (well under 256 KB)');
}

// ── BEHAVIOR: 64-bit frame length path at the cap boundary ───────────
{
  assert(!frameRejected(MAX_WS_FRAME_BYTES), `frame at exactly cap (${MAX_WS_FRAME_BYTES} B): accepted`);
  assert(frameRejected(MAX_WS_FRAME_BYTES + 1), `frame at cap+1: rejected`);
  assert(frameRejected(257 * 1024), '257 KB frame: rejected');
  assert(frameRejected(1024 * 1024 * 1024), '1 GB frame: rejected (was the original DoS vector)');
}

// ── BEHAVIOR: typical Falcon protocol message ───────────────────────
{
  // Real Falcon messages are tiny JSON. Confirm none of them ever
  // approach the cap.
  assert(!frameRejected(500), 'typical 500-byte Falcon JSON: accepted');
  assert(!frameRejected(8 * 1024), '8 KB frame: accepted');
  assert(!frameRejected(100 * 1024), '100 KB frame: accepted');
}

// ── BEHAVIOR: buffer cap at the boundary ────────────────────────────
{
  assert(!bufferOverflow(0, MAX_WS_BUFFER_BYTES), `buffer 0 + ${MAX_WS_BUFFER_BYTES}-byte chunk: accepted (boundary)`);
  assert(bufferOverflow(0, MAX_WS_BUFFER_BYTES + 1), 'buffer 0 + (cap+1)-byte chunk: rejected');
  assert(!bufferOverflow(MAX_WS_BUFFER_BYTES, 0), 'buffer at cap + 0-byte chunk: accepted');
  assert(bufferOverflow(MAX_WS_BUFFER_BYTES, 1), 'buffer at cap + 1-byte chunk: rejected');
  assert(!bufferOverflow(800 * 1024, 100 * 1024), '800 KB buffer + 100 KB chunk: accepted (under cap)');
  assert(bufferOverflow(800 * 1024, 300 * 1024), '800 KB buffer + 300 KB chunk: rejected');
}

// ── BEHAVIOR: drip-feed attack scenario ──────────────────────────────
// 100 small chunks of 11 KB each = 1.1 MB. Without the cap, this would
// grow state.buffer unbounded as the parser waits for a complete frame
// that never arrives. With the cap, the cumulative chunk size triggers
// rejection somewhere in the middle.
{
  const chunkSize = 11 * 1024;
  let bufLen = 0;
  let triggered = false;
  let chunksAccepted = 0;
  for (let i = 0; i < 200; i++) {
    if (bufferOverflow(bufLen, chunkSize)) {
      triggered = true;
      break;
    }
    bufLen += chunkSize;
    chunksAccepted++;
  }
  assert(triggered, 'drip-feed attack: cap fires before 200 chunks accumulate');
  // The cap should fire when the next chunk would push us over 1 MB.
  // Math: floor(1 MB / 11 KB) = floor(1024/11) = 93. So we accept 93 chunks
  // (totaling 93*11 = 1023 KB), then chunk 94 (would push to 1034 KB) is rejected.
  assert(
    chunksAccepted >= 90 && chunksAccepted <= 95,
    `drip-feed: ~93 chunks accepted before cap fires (got ${chunksAccepted})`,
  );
}

// ── STRUCTURAL: production file uses the constants in the right places ──
{
  const src = readFileSync(PROD_FILE, 'utf8');

  // 1. Both constants are declared.
  assert(
    /const\s+MAX_WS_FRAME_BYTES\s*=\s*256\s*\*\s*1024\b/.test(src),
    'production file declares MAX_WS_FRAME_BYTES = 256 * 1024',
  );
  assert(
    /const\s+MAX_WS_BUFFER_BYTES\s*=\s*1024\s*\*\s*1024\b/.test(src),
    'production file declares MAX_WS_BUFFER_BYTES = 1024 * 1024',
  );

  // 2. The old MAX_SAFE_INTEGER cap is gone (modulo comments).
  const codeOnly = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert(
    !/MAX_SAFE_INTEGER/.test(codeOnly),
    'old MAX_SAFE_INTEGER frame cap is gone from code (allowed in comments)',
  );

  // 3. Both frame-length paths reference MAX_WS_FRAME_BYTES.
  // The 16-bit path: there's a `len === 126` block. Inside it, the cap
  // must appear before the next else-if. We verify by counting cap
  // references on either side of the readUInt16BE / readBigUInt64BE.
  const ref16 = src.indexOf('readUInt16BE(2)');
  const ref64 = src.indexOf('readBigUInt64BE(2)');
  assert(ref16 > 0 && ref64 > 0, 'both length-decoding sites are present');

  // Find MAX_WS_FRAME_BYTES references.
  const frameCapPositions: number[] = [];
  let idx = src.indexOf('MAX_WS_FRAME_BYTES');
  while (idx !== -1) {
    frameCapPositions.push(idx);
    idx = src.indexOf('MAX_WS_FRAME_BYTES', idx + 1);
  }
  // We expect: 1 declaration + 1 in the 16-bit path + 1 in the 64-bit path = 3+.
  assert(
    frameCapPositions.length >= 3,
    `MAX_WS_FRAME_BYTES referenced at least 3 times (decl + 16-bit + 64-bit) — got ${frameCapPositions.length}`,
  );
  // At least one ref between the 16-bit decode and the 64-bit decode site
  // (the 16-bit cap check) and at least one after the 64-bit decode (the
  // 64-bit cap check).
  const between16and64 = frameCapPositions.some(p => p > ref16 && p < ref64);
  const after64 = frameCapPositions.some(p => p > ref64);
  assert(between16and64, 'MAX_WS_FRAME_BYTES enforced in the 16-bit decode block');
  assert(after64, 'MAX_WS_FRAME_BYTES enforced in the 64-bit decode block');

  // 4. The buffer cap fires in the data event handler, BEFORE the concat.
  const concatPos = src.indexOf('Buffer.concat([state.buffer, chunk])');
  assert(concatPos > 0, 'data-event Buffer.concat site is present');
  const bufCapPositions: number[] = [];
  let bidx = src.indexOf('MAX_WS_BUFFER_BYTES');
  while (bidx !== -1) {
    bufCapPositions.push(bidx);
    bidx = src.indexOf('MAX_WS_BUFFER_BYTES', bidx + 1);
  }
  assert(
    bufCapPositions.length >= 2,
    `MAX_WS_BUFFER_BYTES referenced at least 2 times (decl + check) — got ${bufCapPositions.length}`,
  );
  const beforeConcat = bufCapPositions.some(p => p < concatPos && p > src.indexOf("socket.on('data'"));
  assert(beforeConcat, 'MAX_WS_BUFFER_BYTES check is between socket.on("data") and Buffer.concat');

  // 5. Each cap violation calls destroySocket + scheduleReconnect.
  // We don't bind the test to specific reconnect reason strings (those
  // can be edited freely); we just assert the destroy/reconnect pair
  // appears at least 5 times in the file (existing reconnect sites + 2
  // or 3 new T1-94 ones).
  const destroyMatches = src.match(/destroySocket\(\)/g) ?? [];
  const reconnectMatches = src.match(/scheduleReconnect\(/g) ?? [];
  assert(
    destroyMatches.length >= 5,
    `destroySocket() called at least 5 times (existing + new T1-94 sites) — got ${destroyMatches.length}`,
  );
  assert(
    reconnectMatches.length >= 5,
    `scheduleReconnect(...) called at least 5 times — got ${reconnectMatches.length}`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
