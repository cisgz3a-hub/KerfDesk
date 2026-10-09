# Rolling audit — platform adapters (Web Serial transport + file/camera adapters)

- **When:** 2026-07-17 07:15 (+08)
- **Tree:** audit branch rebased onto `origin/main` @ `ed40b6d5` this iteration — files audited are current main.
- **Scope:** `src/platform/web/{web-serial,web-adapter,web-camera}.ts`, `src/platform/types.ts` (contract skim), `src/platform/electron/` (detection-only module), plus the store-side subscriber wiring the transport depends on.
- **Method:** static read + dispatch-chain tracing into `laser-connection-actions.ts`. **Not verified:** nothing executed in a browser; Web Serial semantics (event timing, stream-lock behavior) are taken from spec and the module's own documented audits, not exercised against hardware.
- **Report-only** per CLAUDE.md collaboration rule 1 — nothing was fixed.

---

## P2-1 — a throwing line subscriber tears down the serial transport mid-job

The read loop dispatches inbound lines to subscribers inside its own `try` ([web-serial.ts:256-264](../../src/platform/web/web-serial.ts)): any synchronous exception from a handler exits the loop through `catch` → `finally` → `onEnd`, which is `handleDroppedConnection` — streams cancelled, `fireClose` fired. The store then applies the port-closed patch, indistinguishable from a cable yank.

The only production subscriber is the store's wrapper, which calls `handleLine` with **no** try/catch ([laser-connection-actions.ts:121-123](../../src/ui/state/laser-connection-actions.ts)) — and `handleLine` fans out across status parsing, transcript recording, ack attribution, settings collection, and stream advance. A defect anywhere in that wide surface converts one bad line into a **full mid-job disconnect** (job dead, recovery flow engaged) instead of a logged error. Two aggravators: (a) lines already decoded from the same chunk after the throwing one are silently dropped; (b) the operator-facing symptom ("port closed") points at the cable, not the software.

Fix direction: wrap the per-line dispatch (or per-handler call) in try/catch + `console.error`, keeping loop-fatal behavior only for genuine stream errors from `reader.read()`.

---

## P3-2 — `pickFilesForOpen` doesn't check for API support, though the module promises "fail clearly"

`web-adapter.ts` states unsupported browsers "fail clearly instead of creating a second persistence path" ([web-adapter.ts:3-6](../../src/platform/web/web-adapter.ts)) and `pickFileForSave` honors that with an explicit capability check and message ([web-adapter.ts:51-53](../../src/platform/web/web-adapter.ts)) — but `pickFilesForOpen` calls `window.showOpenFilePicker` unchecked ([web-adapter.ts:34](../../src/platform/web/web-adapter.ts)), so a non-Chromium browser gets a raw `TypeError: window.showOpenFilePicker is not a function`. Low impact (Chromium-only delivery target), but it contradicts the module's stated contract and its own sibling function.

---

## Verified clean (checked, no finding)

- **The stale-port sweep cannot kill the live connection:** an active port's reader/writer locks make its `close()` reject, which the sweep swallows ([web-serial.ts:41-59](../../src/platform/web/web-serial.ts)) — only genuinely stale (open, unlocked) handles are reaped before the picker.
- **Close/forget idempotency:** the `ctx.closed` guard, memoized `forgetPromise`, and the `needsClose` split handle deliberate close, cable yank, close-then-forget, and concurrent forget correctly; Forget still revokes the pairing after a prior normal close (documented A2 fix), while the yank path deliberately keeps the pairing ([web-serial.ts:130-196](../../src/platform/web/web-serial.ts)).
- **`fireClose` fires exactly once** on every path (yank event + read-loop end + deliberate close all converge on the guard).
- **Wire encoding (M12):** byte-per-char with a thrown error for >0xFF keeps GRBL realtime bytes (0x85, 0x90–0xA2) exact instead of UTF-8-mangled ([web-serial.ts:198-217](../../src/platform/web/web-serial.ts)).
- **Line-length DoS cap** (64 KiB) applies to both terminated and partial lines; `extractSerialLines` is pure and unit-tested ([web-serial.ts:219-245](../../src/platform/web/web-serial.ts)).
- **Write ordering:** a single shared `WritableStreamDefaultWriter` queues concurrent writes in call order — no interleaving without an app-level mutex.
- **Save path atomicity:** `writeAndClose` aborts the writable on any failure so a failed save never commits a truncated file ([web-adapter.ts:73-94](../../src/platform/web/web-adapter.ts)).
- **Camera adapter** stops all tracks on release and retries `getUserMedia` without a stale `deviceId` on over-constraint.
- **Boundary compliance:** `platform/web` imports only `core` + `platform/types` (matches the ESLint matrix verified in iteration 6).

## Not verified

- No browser-runtime exercise of the transport (open/yank/reopen cycles, Chromium lock semantics under race) — code-and-spec reading only.
- `camera-bridge.ts` (HTTP bridge) and `types.ts` beyond a contract skim; Electron main-process serial (if any) is out of scope — the renderer inherits Web Serial.
