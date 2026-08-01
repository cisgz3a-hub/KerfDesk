# 6 — Controllers and transport

How bytes actually reach the machine, and what happens when they don't.

## The driver seam

**ADR-094** (`DECISIONS.md:3827`) introduced `ControllerDriver` as the single seam every firmware
family drives the whole app through: connect → identify → jog/frame → run/pause/resume/software-abort
→ recover, with output, streaming, console, settings, and UI **capability-gated per firmware**.

The design rule is stated at `src/core/controllers/controller-driver.ts:1-6`: drivers are **pure data
plus pure functions**. They build strings and classify lines; they never touch the serial port, the
clock, or React. A `null` command entry means *"this firmware has no such operation"*, and callers gate
on capabilities before reaching for it.

Realtime bytes are declared explicitly (`controller-driver.ts:22-34`):

| Field | GRBL byte | Purpose |
|---|---|---|
| `statusQuery` | `?` | Status report, written outside the line queue |
| `hold` | `!` | Feed hold |
| `safetyDoor` | `0x84` | Controlled motion stop **plus accessory shutdown** |
| `resume` | `~` | Cycle start / resume |
| `softReset` | `0x18` | Abort / soft reset |
| `jogCancel` | `0x85` | Cancel the in-flight jog only |

`safetyDoor` (`0x84`) is the byte ADR-180 amendment 2 uses to park the spindle on CNC Pause — it stops
motion *and* accessories, which a plain feed hold does not.

Two de-energize line sets exist and the distinction matters (`controller-driver.ts:54-60`):
`stopLaserLines` is best-effort **after** an Abort (a soft reset has usually already fired), while
`frameToolOffLines` must be dispatched **and acknowledged before any Frame motion** — callers cannot
rely on a preceding soft reset there, so those lines must explicitly de-energize every driver-owned
cutting accessory.

## Supported families

| Family | ADR | Status |
|---|---|---|
| GRBL v1.1+ | ADR-006 | **Hardware-verified** — Falcon A1 Pro, maintainer, 2026-07-02 |
| grblHAL | ADR-094 I.2 | **Hardware-verified** — same machine, GrblHAL 1.1f |
| FluidNC | ADR-094 I.2 | Simulator only; settings read-only |
| Marlin | ADR-095 (`:3871`) | Simulator only — queued `M114`, stream-side pause, `G28 X Y`, `M400` settle |
| Smoothieware | ADR-096 (`:3899`) | Simulator only — fractional `S` (e.g. `S0.500` at 0–1.0 scale) |
| Ruida | ADR-097 (`:3923`) | **Experimental** `.rd` export, `transport: 'file-only'`, never accepted by real hardware |

The hardware truth table at `PROJECT.md:195-200` records an important secondary conclusion: because
the Falcon's normal `grbl-v1.1` profile drives it through the **rewritten** driver path unchanged, the
2026-07-02 pass also proves the ADR-094 driver refactor is byte-identical on real hardware.

Simulator verification is not a weak substitute — `src/__fixtures__/controllers/` holds scripted
firmware simulators driving the **real** laser-store (`PROJECT.md:170-171`). What it cannot prove is
timing, electrical behavior, or firmware quirks.

**ADR-157** (`:7412`) reconciles detected firmware, streaming mode, receive window, output dialect,
active driver, and Start readiness through one fail-closed policy, and **refuses cross-family profile
selection after detection**.

## Character-counted streaming

`src/core/controllers/grbl/streamer.ts` (395 lines) is a **pure state machine** — it never touches the
port. It answers "what should I send next?"; the platform adapter does byte I/O and feeds responses
back via `onAck` (`streamer.ts:14-17`).

The algorithm (`streamer.ts:7-13`): GRBL's serial RX buffer is 128 bytes. The sender keeps a running
tally of bytes sent but not yet acknowledged and sends the next line only if it fits the remaining
headroom. Each `ok` or `error:N` pops the head-of-queue line and frees its bytes.

**Buffer size is 120, not 127.** The comment (`streamer.ts:22-26`) records the reasoning honestly: we
previously used 127 (1-byte margin) and were off-by-one in the conservative direction; an MIT-compare
audit recommended matching CNCjs's 120 (8-byte margin) to protect against senders that add CR/LF and
transient queueing edge cases. **No observed bug at 127 — the change was preventive.** A good example
of the repo's citation discipline: labeled unproven-but-cheap rather than dressed up as a bug fix.

### Status model

Eight statuses (`streamer.ts:47-55`), and the distinctions are all load-bearing:

`idle` · `streaming` · `paused` · `tool-change` · `done` · `cancelled` · `disconnected` · `errored`

- **`errored` vs `cancelled`.** An `error:N` ack is **terminal** — ADR-041 (`DECISIONS.md:2249`). The
  stated reason (`streamer.ts:35-38`): terminality protects against a laser-on line firing at a
  mispositioned head after a rejected move. Noted as matching both CNCjs and LightBurn.
- **`disconnected` vs `cancelled`.** Same data effect, different wording so the UI can say "job
  aborted — connection lost" instead of implying the user stopped it.
- **`errored` stays inside `isActiveJob`** (`streamer.ts:357-362`) so Stop and soft-reset remain
  available — the port may still be alive and GRBL may still be executing buffered lines.

### Three subtle correctness fixes worth preserving

Recorded in comments as audit findings. Each is the kind of bug that reports a clean finish over a
real failure:

1. **Terminal statuses are absorbing** (`streamer.ts:176-184`, finding H5). Without it, the `ok` acks
   trailing an `error:N` in the final RX window drained the queue and promoted the stream back to
   `done` — reporting success over a rejection.
2. **`ALARM:N` wipes all in-flight lines** (`streamer.ts:283-287`, finding F1). The firmware discarded
   its RX buffer and planner, so those lines will never be acked; keeping them would make the store's
   ack-attribution layer claim every later untracked ack (`$X` unlock, `M9` cleanup) for a dead stream.
3. **A paused stream never promotes to `done`** (`streamer.ts:288-292`). GRBL keeps acking
   held-but-parsed lines during a feed hold, so pausing near the end of a job drains the queues while
   the machine still holds unexecuted planner motion. `resume()` completes a drained stream instead
   (`streamer.ts:332-342`).

### The oversized-line refusal

`findOversizedLine` (`streamer.ts:162`) exists because a line longer than the RX buffer **can never
satisfy `step()`'s send condition** — the loop would break with nothing sent, no error, no state
change, freezing the job at 0/N (finding M13). Callers must check before creating a streamer so the job
is refused loudly. This is one of the three legitimate non-guard refusals under non-negotiable #21: a
line larger than the RX buffer is a factual transport inability.

### Line accounting

`isSendableGcodeLine` (`streamer.ts:138`) is the **single** definition of sendable: non-blank,
non-comment. Blank lines and full-line comments are never streamed, so `completed`/`total` count only
those. The comment carries an explicit coupling warning (`streamer.ts:134-137`): the job-checkpoint
mapper in `core/recovery` (ADR-118) uses the same predicate to convert an acked count back to a raw
file line number, and **the two must not drift**.

## Transport

- **Web/PWA:** WebSerial via `src/platform/web/web-serial.ts`. First-class delivery target on Chromium
  browsers (`PROJECT.md:37`). *Brave caveat:* WebSerial ships but may be gated behind a Shields/flags
  toggle; upstream `brave-browser#24404` was still open at last re-verification 2026-05-28.
- **Desktop:** Electron with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, **no
  preload and no `ipcMain` surface** (`PROJECT.md:491`). `setPermissionRequestHandler` returns `false`
  except for `serial`, `fileSystem*`, `media` (video-only), and `screen-wake-lock`.
- **Ruida:** `transport: 'file-only'` — no live link. The pure UDP session state machine exists as
  groundwork only (`PROJECT.md:186-188`).

## Console and diagnostics

**ADR-229** (`:10010`) added the super console with a guarded command dialog. Per project memory (Super
Console audit 2026-07-19) a **P2 remains open**: a console `$$` can wedge `controllerOp` because there
is no timeout. **Not re-verified in this session.**

**ADR-183** (`:7910`) makes unexpected GRBL terminal responses invalidate controller ownership.
**ADR-182** (`:7870`) makes grblHAL MPG ownership a latched CNC Start blocker — a permitted
transport-precondition refusal (another controller physically owns the machine).

## Cross-reference slot — Phase 2

1. **Buffer strategy.** Does LightBurn use character-counted or simple send-response? What buffer size?
   Ours is 120 bytes copying CNCjs.
2. **`error:N` handling.** `streamer.ts:38` claims error-as-terminal matches LightBurn. **Verify** —
   this is a claim about a competitor made in a code comment with no cited source.
3. **Pause semantics.** Does LightBurn's pause use `!` feed hold, or also shut accessories down? Ours
   uses `0x84` safety-door for CNC (ADR-180 am. 2) and `!` elsewhere.
4. **Reconnect mid-job.** Can LightBurn resume after a cable drop? We mark the stream `disconnected`
   and terminal. If they can recover, that is a genuine capability gap.
5. **Status poll rate.** What `?` interval does LightBurn use? Project memory records a real bug where
   a status poll was killed (#308) — worth comparing cadence.
6. **Tool change.** Does LightBurn/Easel swallow `M0` to reach Idle as we do (`streamer.ts:39-46`)?
7. **Console.** Does LightBurn expose a raw console, and does it time out a hung query? Our missing
   timeout is a known open P2.
