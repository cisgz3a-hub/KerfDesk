# Controller audit v2 — C5 Console, macros and controller responses (`ctl-console-responses`)

- **When:** 2026-10-22 09:55   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `8e2fdc9eb`;
  only audit docs differ from `99a2e64b7` under `src/`)
- **Scope:**
  - Core: `src/core/controllers/grbl/console-command.ts`, `response.ts`, `response-presentation.ts`,
    `error-codes.ts`, `grblhal-error-codes.ts`, `alarm-codes.ts`, `build-info.ts`,
    `grbl-machine-mode.ts`, `line-buffer-limit.ts`, `sendable-line-scan.ts`;
    `src/core/controllers/console-text.ts`, `console-state-effect.ts`, `console-setting-writes.ts`.
    Followed into the driver wrappers that reuse the GRBL classifier (`grblhal/driver.ts`,
    `fluidnc/driver.ts`, `fluidnc/fluidnc-command-names.ts`, `falcon-command-contract.ts`) and the
    twin parser `src/core/external-program/normalize-external-program.ts`.
  - Store: `src/ui/state/laser-console-actions.ts`, `console-command-readiness.ts`,
    `console-command-transport.ts`, `laser-console-settings-write.ts`, `frame-wcs-selection.ts`
    (`trackConsoleWcs`), `laser-transcript.ts`.
  - UI: `src/ui/laser/console/**` (command deck, availability, `run-console-command.ts`,
    `user-macros/**`), `src/ui/laser/super-console/**` (dialog, transcript filters/TSV, diagnostic
    bundle and redaction).
  - Governing: ADR-293 (one-command macros), ADR-229 (Super console), ADR-362 decision 1 (every
    `$RST=` form blocked), ADR-375 decision 9 (read-only reports, `$DWNGRD` joins the blocked
    persistent commands, setting writes re-read), ADR-400 (FluidNC long names, `$NVX`), ADR-162
    (Fire), WORKFLOW F-B13/F-B13a/F-B13b, AGENTS.md "never operate hardware".
- **Lenses run:** L1, L2, L3, L4, L5, L6, L7, each as its own pass in this session (no subagents:
  the PC is under memory pressure). L5 covered typed Console input, saved macros (local storage
  only; there is no import path), MCP/phone (no Console path) and the controller text that flows
  into exported files. L6 was light: Console write failures and owned exchanges were read, not
  re-tested.
- **Primary sources fetched this session** (raw files, saved to the scratchpad):
  - gnea/grbl `bfb67f0`: `doc/csv/error_codes_en_US.csv`, `doc/csv/alarm_codes_en_US.csv`,
    `grbl/protocol.c` (L96 `$` dispatch, L113-148 line collection), `grbl/protocol.h` (L31-32),
    `grbl/system.c` (L179-190 `$H`, L220-237 `$RST`, `$N`).
  - GRBL wiki: `Grbl-v1.1-Interface.md` (error and alarm tables), `Grbl-v1.1-Laser-Mode.md`
    (M3 constant power).
  - grblHAL core `d7aaee3`: `errors.h`, `errors.c`, `alarms.h`, `alarms.c`, `protocol.c`
    (L225-321), `protocol.h` (L35-36), `system.c` (L1000-1060 command table, L1140-1215
    `system_execute_line`), `settings.c` (L2399 `$32`). grblHAL `master` `errors.h`/`alarms.h`
    are byte-identical to `d7aaee3`.
  - grblHAL Plugin_SD_card `master`: `fs_stream.c` (L911-928 command table), `sdcard.c`
    (L231-232).
  - FluidNC `25ae119b` (the pin in `response-presentation.ts`): `Error.h`, `Error.cpp`, `Alarm.h`,
    `Protocol.cpp` (L28-47, L229-230, L257), `Report.cpp`, `Channel.cpp` (L266-280). FluidNC
    `v4.0.3`: `ProcessSettings.cpp` (L688-697, L1034, L1041, L1067, L1080, L1209-1240),
    `FileCommands.cpp` (L249-273, L659-690), `SettingsDefinitions.cpp` (L146).
- **Counts:** 4 raised → refuter: 4 confirmed, 0 plausible, 0 refuted → P1 0 / P2 1 / P3 3
  (+5 KNOWN re-observed). No severity changes; scenario corrections in P2-1 (window about 100 s)
  and P3-1 (`$RST=*` reboots, so its evidence is cleared).

## Headline

The Console's classifier is sound for what it was written against: realtime characters, control
bytes and non-ASCII are refused, lowercase and spaced spellings are compacted, setting writes need
confirmation plus fresh Idle, `$RST=`/`$N…=`/`$I=`/`$DWNGRD` are blocked, and everything but `?`
is refused during a job. Macros are genuinely one line and go through the same parser and store
gate. The error and alarm tables match GRBL, grblHAL and FluidNC sources.

The most important new issue is not in the classifier. The Super Console's **diagnostic bundle**,
which exists to be sent to support, includes the raw `$$` reply lines from the recent transcript
(on by default) while its own disclosure says "raw settings values" are omitted. On a grblHAL
network build that puts the Wi-Fi, AP and MQTT passwords in the file (P2-1, the third sink of
rolling-v2 27-P2-3). The classifier gaps that remain are spelling bypasses of the same kind as
17-P3-2: on stock GRBL a `( … )` or `;` comment hides a `$` command from the classifier
(P3-1), and controller file-system commands (`$F=`, `$SD/Run=`, `$LocalFS/Format=`) pass as one
ordinary line (P3-2).

## Console path map

| Step | Code | What it decides |
|---|---|---|
| Input | `ConsoleCommandDeck` → `use-console-command-deck-model.ts`; macros: `UserMacroPanel` → `expandUserMacroTemplate` → same deck `send` | One draft or one expanded macro line |
| Text policy | `console-text.ts` (`normalizeConsoleSpaces`, `consoleTextRefusal`); `console-command.ts:167-171` | Unicode spaces → space; control bytes, DEL, ≥0x7F refused; CR/LF refused |
| Classify | `driver.prepareConsoleCommand` (`console-command.ts:70-105`, wrapped by grblHAL `:44-60`, FluidNC `:45-54`, Falcon `:40-45`) | Kind, wire, `requiresIdle`, `requiresNoActiveOperation`, `requiresConfirmation`, `stateEffect`, `allowedStates` |
| Advisory UI gate | `console-command-availability.ts:96-130` | Disabled reason shown on Send |
| Value policy | `consoleSettingWriteIssue` (`console-setting-writes.ts:176-192`), ADR-180 `$32` rule (`grbl-setting-write.ts:85-93`) | `$N=` refused before the confirm prompt |
| Confirm | `run-console-command.ts:37-42` (`jobAwareConfirm`) | Only `requiresConfirmation` (setting writes) |
| Store gate | `laser-console-actions.ts:97-139`, `console-command-readiness.ts:18-45` | Connection, reset-required latch, MPG, operation owner, fresh Idle, ownership; re-checked after the async fresh-Idle wait |
| Evidence | `invalidateConsoleCommandEvidence`, `consoleStateEffectPatch`, `beginConsoleSettingWriteEvidence`, `trackConsoleWcs` | Frame/homing/origin/Z evidence expiry, `$13` units, `$$` re-read, WCS re-read after `$H` |
| Send | `writeConsoleCommand` (`console-command-transport.ts:29-86`) | Owned exchange for `$$`, `$N=`, `$X`, M115; plain write otherwise |

## Findings

### P2-1 — The Super Console diagnostic bundle carries the raw `$$` reply lines (grblHAL passwords included) while its disclosure says raw settings values are omitted

- **Where:**
  - `src/ui/laser/super-console/diagnostic-bundle.ts:60-75`. `diagnosticTranscript` keeps every
    transcript entry except `source` `job`/`motion` and `kind` `gcode`. Inbound `$N=` reply lines
    are `kind: 'setting'` (`laser-transcript.ts` `inboundKind`), and a typed `$N=` write is
    `kind: 'setting-write'`, so both are kept. The only filter is `redactDiagnosticText`
    (`diagnostic-redaction.ts:5-12`), which drops a line only when it contains a keyword such as
    `password` or `ssid`; `$75=hunter2` contains none.
  - `diagnostic-bundle.ts:188`. The bundle's `disclosure.omitted` lists `'raw settings values'`.
    The settings block itself does keep only `numericValue` (`:130`), so the claim is true of that
    block and false of the transcript block in the same file.
  - `src/ui/laser/super-console/DiagnosticBundleReview.tsx:10`. `includeTranscript` defaults to
    `true`. The panel text (`:121`, `:125`) says the bundle has "numeric settings".
- **Anchor:**
  - Contract: the bundle's own disclosure (`diagnostic-bundle.ts:188`) and the panel text,
    which say raw settings values are not in the file.
  - Ground truth: grblHAL `settings.c` `setting_get_value` prints a `Format_Password` setting in
    clear over serial unless a WebUI is connected, so `$$` prints `$75` (STA password), `$77` (AP
    password), `$330`/`$331` and `$533` (MQTT password) verbatim (sources and ids as confirmed by
    C4-P3-7 and rolling-v2 27-P2-3).
  - Twin: rolling-v2 27-P2-3 (P2, PR #1364 open) redacts the same ids in the support report; C4
    cited this bundle as the redacted twin, which this finding corrects.
- **Scenario:** grblHAL board with networking enabled and passwords set (Wi-Fi STA, AP or MQTT).
  1. Connect. The handshake sends `$$`, and every `$N=` reply line enters the transcript as
     `kind: 'setting'`.
  2. Open the Super Console and click **Review diagnostic bundle** while those lines are still in
     the last 200 transcript entries (`DIAGNOSTIC_TRANSCRIPT_LIMIT`). At the 1 s Idle poll that is
     roughly the next 100 to 200 s; any later `$$` (Machine Settings **Read**, a Console `$$`, the
     re-read after a reset) starts the window again. "Connect, then export diagnostics" is the
     usual support flow.
  3. The JSON contains `"raw":"$75=<wifi password>"` and `"raw":"$533=<mqtt password>"` among
     the transcript rows, while `disclosure.omitted` says `raw settings values`. The operator is
     asked to review a JSON of up to 128 KiB and then sends the file to support.
  - A typed Console write such as `$75=newpass` is kept the same way (`kind: 'setting-write'`).
- **Evidence:** REPRO (two temporary tests, since deleted).
  - `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-c5-bundle-store.test.ts --silent=false`
    (1 passed). Real store connected with `{controllerKind:'grblhal'}`, banner `GrblHAL 1.1f`;
    the handshake wrote `$$\n`, the fake answered `$70=7`, `$75=hunter2pass`, `$100=80.000`,
    `$533=mqttSecret9`, `ok`. `state.transcript` held them as `["in","setting","$75=hunter2pass"]`
    etc. `createDiagnosticBundle({ laser: state, includeTranscript: true, … })` gave
    `bundleHasPassword: true`, `bundleHasMqtt: true`, `omittedClaim: true`.
  - `src/ui/laser/super-console/zz-c5-bundle.test.ts` (1 passed) built the entries with the real
    `inboundTranscriptEntry`/`outboundTranscriptEntry`: the bundle transcript was
    `["setting","$75=hunter2pass"]`, `["setting","$533=mqttSecret9"]` and
    `["setting-write","$77=apSecret77\n"]`.
- **Refuter:** CONFIRMED (REPRO + SOURCE). P2 kept. Not KNOWN: PR #1364 does not cover it.
  - Refutation tried: the handshake `$$` replies might not reach `state.transcript`; something
    upstream might filter `setting` rows; grblHAL might mask passwords over serial; PR #1364 might
    already redact this path. None of these held.
  - Repro (temporary `src/ui/state/zz-c5r-bundle-store.test.ts`, since deleted): the real store
    and fake serial port, `connect(…, { controllerKind: 'grblhal' })`, banner `GrblHAL 1.1f`.
    - The handshake wrote `$$\n` and `$G\n`. The fake answered `$75=hunter2pass`,
      `$77=apSecret77` and `$533=mqttSecret9`, and the transcript held all three as
      `in/controller/setting`.
    - `createDiagnosticBundle({ …, includeTranscript: true })` contained all three verbatim, with
      `decoded: null`. `disclosure.omitted` listed `raw settings values`, and the settings block
      held `numericValue: null` for 75, 77 and 533.
    - Every inbound line is transcribed (`laser-line-handler.ts:92` `recordInboundLine`). The
      bundle filters only `job`/`motion`/`gcode` and `redactDiagnosticText`.
  - Source: grblHAL core `master`:
    - `settings.c:1961-1962`: a `Format_Password` value is printed unless
      `hal.stream.state.webui_connected`.
    - `system.c:313`: `$$` runs `report_grbl_settings(true, …)` at the default
      `COMPATIBILITY_LEVEL 0` (`config.h:97`), so plugin and driver settings are included.
    - `settings.h:131,133,199,200,372`: ids 75, 77, 330, 331 and 533.
  - PR #1364 (open, head `bf6e7b1`) changes `src/ui/support/support-report-redaction.ts` and
    `support-report.ts` only. It touches nothing under `src/ui/laser/super-console/`, and
    `diagnostic-redaction.ts` is unchanged. No open PR touches the bundle. This is a further sink of
    27-P2-3.
  - Correction to the scenario: the window is about 100 s, not 100 to 200 s. Each 1 s Idle poll
    adds two entries (the outbound `?` as `out/poll/realtime` and the status reply). The repro
    gained 120 entries in 60 s, so a `$$` row leaves the last 200 after roughly 100 s.
  - Severity: P2, matching 27-P2-3. It holds the same secrets, goes to the same support
    audience, and the file's own disclosure is false. Mitigations: the panel asks the operator to
    check for unlabelled secrets, nothing is sent automatically, and it needs a grblHAL network
    build with passwords set. That is METHOD §3's "unusual conditions", which is still P2.
- **Fix direction:** Drop `setting` and `setting-write` transcript rows from the bundle (the
  settings block already carries the numeric values), or mask the value of every known password id
  as PR #1364 does for the support report. Add a test with a `$75=` row.

### P3-1 — On stock GRBL a `( … )` or `;` comment hides a `$` command from the Console classifier: `(x)$RST=*`, `$32(x)=0`, `(x)$13=1` and `$H ;home` go out unblocked, unconfirmed and without their re-reads

- **Where:**
  - `src/core/controllers/grbl/console-command.ts:79`. `compact` strips blanks only when the line
    starts with `$`. `isBlockedPersistentCommand` (`:81`, `:227-233`), `SETTING_WRITE_RE` (`:88`)
    and `HOME_OR_SLEEP_RE` (`:99`) all test `^\$` on a form that still contains the comment, so the
    line falls through to `gcode` with `requiresConfirmation: false` and
    `stateEffect: 'machine-state'` (`:103-104`).
  - `src/ui/state/laser-console-settings-write.ts:24`. `reportUnitsWrite` tests `^\$0*13\s*=` on
    the same uncollected text.
  - `src/ui/state/frame-wcs-selection.ts:74-76`. The post-homing WCS re-read runs only for
    `stateEffect === 'reference'`.
- **Anchor:**
  - Ground truth: gnea/grbl `protocol.c` `protocol_main_loop` drops `( … )` and `;` comments,
    `/` and blanks while collecting the line (L113-148: `} else if (c == '(') {` / "ignore all
    characters until ')' or EOL"), then dispatches on the collected `line[0] == '$'` (L96).
    `system.c` L220-230 runs `$RST=*` as `settings_restore(SETTINGS_RESTORE_ALL)`. grblHAL keeps
    comments in the line buffer (`protocol.c` L296-321) and dispatches `$` only on the first
    stored character, so this is stock GRBL only.
  - Contract: ADR-362 decision 1 ("every `$RST=` form is blocked"); WORKFLOW F-B13 "Error — unsafe
    persistent command" (`$N=`/`$I=` blocked, `$n=` confirmed and re-read); ADR-180 Amendment 6
    (`$32` per machine kind); audit GP-1's fix (after `$H` the WCS is unknown and re-read).
  - Twin: `normalize-external-program.ts:127-139` runs `stripComments` before its `$` check, so
    the same `(x)$RST=*` line in an opened program is refused as a controller command.
- **Scenario:** stock GRBL profile, Idle.
  - `(x)$RST=*`, `(wipe) $RST=*` or `$RST(x)=*`: sent with no block or prompt; GRBL wipes every
    setting, offset and startup line. KerfDesk keeps its settings snapshot, work origin and Z
    evidence (`machine-state` keeps them).
  - `(x)$N0=G55` and `(x)$I=abc`: the blocked startup-line and build-info writes are sent.
  - `$32(laser off)=0` or `(note)$32=0` on a laser: no confirmation, no ADR-180 refusal, no
    stock-GRBL value check and no `$$` re-read, so Job Review's `$32` advisory keeps reading
    `$32=1`.
  - `(x)$13=1`: GRBL switches its reports to inches; `reportUnitsUnconfirmed` stays false, so the
    DRO and every position-derived check read inches as millimetres.
  - `$H ;home` or `$H (home)` (a natural macro label): classified `machine-state`, Idle-only, so
    it is refused in Alarm where `$H` is accepted, and in Idle `activeWcs` is not cleared or
    re-read. With a stored `$N0=G55`, GRBL ends homing in G55 while KerfDesk still records G54, so
    Frame skips its G54 selection and traces in G55 while the job runs in G54: the GP-1 outcome
    the `reference` effect exists to prevent.
  - Every case needs a comment placed in or before a `$` command, typed or saved in a macro.
- **Evidence:** REPRO and SOURCE (temporary tests, since deleted).
  - `node ../../../node_modules/vitest/vitest.mjs run src/core/controllers/grbl/zz-c5-console.test.ts --silent=false`
    (all passed). Real `prepareConsoleCommand`, with the twin's `canonicalLine(stripComments(…))`
    as the model of what GRBL collects:
    - `$RST=*` → refused; `(x)$RST=*` → `kind:"gcode"`, `confirm:false`,
      `effect:"machine-state"`, wire `(x)$RST=*\n`, GRBL collects `$RST=*`.
    - `$RST(x)=*`, `(x)$N0=G20`, `(x)$I=abc`, `$32(laser off)=0` (wire `$32(laseroff)=0\n`),
      `(note)$32=0`, `(x)$13=1`, `(x)$22=0.5` → each `gcode`, `confirm:false`, `settingIssue:null`.
    - `$H` → `effect:"reference"`, `allowed:["Idle","Alarm"]`; `$H (home)` and `$H;home` →
      `effect:"machine-state"`, `idle:true`, `allowed:null`.
    - grblHAL control: `(x)$RST=*` is also `gcode` there, but grblHAL does not run it as `$`.
  - `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-c5-store.test.ts --silent=false`
    (3 passed), real store over a fake stock GRBL session:
    - `$13=1` unconfirmed → refused; `(x)$13=1` → wire `["(x)$13=1\n"]`, `lastWriteError:null`,
      `reportUnitsUnconfirmed:false`, `workOriginActive:true`, no `$$\n`.
    - `$RST=*` → refused; `(x)$RST=*` → wire `["(x)$RST=*\n"]`, `lastWriteError:null`.
    - With `activeWcs:'G54'`: `$H` → `activeWcs:null`; `$H ;home` → wire `["$H;home\n"]`,
      `activeWcs:"G54"`.
- **Refuter:** CONFIRMED (REPRO + SOURCE). P3 kept; one scenario clause corrected.
  - Source: gnea/grbl `bfb67f0` `grbl/protocol.c` (fetched). The collector drops `c <= ' '`
    (L120), `/` (L122), `(`…`)` (L125) and `;` to end of line (L131) before the
    `line[0] == '$'` dispatch (L96). In `system.c`, `$RST=*` runs
    `settings_restore(SETTINGS_RESTORE_ALL)` (L230) and then `mc_reset()` (L235).
  - Repro (temporary core test, since deleted). Real `prepareConsoleCommand`:
    - `$RST=*` is refused.
    - `(x)$RST=*`, `(wipe) $RST=*`, `$RST(x)=*`, `(x)$I=abc`, `(note)$32=0`, `$32(laser off)=0`
      (wire `$32(laseroff)=0`) and `(x)$13=1` each come out as `gcode`, `confirm:false`,
      `machine-state`.
    - `(x)$N0=G55` comes out as `gcode`, `coordinates-all`.
    - `$H` is `reference` with Idle/Alarm. `$H (home)` and `$H ;home` are `machine-state` and
      Idle-only.
  - No other guard: `sendConsoleCommand` (`laser-console-actions.ts:97-130`) adds no text check.
    `reportUnitsWrite` (`laser-console-settings-write.ts:24`) and the WCS re-read
    (`frame-wcs-selection.ts:74`) key on `^\$0*13\s*=` and `stateEffect === 'reference'`.
  - Correction to the scenario: for `(x)$RST=*`, GRBL's `mc_reset()` reboots and sends a banner.
    `handleWelcomeLine` (`laser-line-handler.ts:350`, `:398`) then clears the settings rows, origin
    and Z evidence. "KerfDesk keeps its settings snapshot, work origin and Z evidence" is therefore
    wrong for that case. The unblocked EEPROM wipe stands, as do the `$13`, `$32`, `$N0`, `$I` and
    `$H ;home` outcomes.
  - Severity: P3. Every case needs the operator to put a comment into a `$` command (the same
    class as 17-P3-2).
- **Fix direction:** Classify Console and macro lines from the form stock GRBL collects (strip
  `( … )`, `;`-to-end, `/` and blanks, as `normalize-external-program.ts` does) before the `$`
  checks, and send that canonical form on the stock driver. This closes 17-P3-2 at the same time;
  its fix direction as written (drop `/` and blanks) would not close the comment form. Add tests
  for `(x)$RST=*`, `$32(x)=0` and `$H ;x`.

### P3-2 — Controller file-system commands are ordinary one-line G-code: a one-command macro can start a controller-resident program or format the controller's file system with no block or prompt

- **Where:** `src/core/controllers/grbl/console-command.ts:103-104`. Anything not matched earlier
  becomes `gcode` with `requiresConfirmation: false` and `stateEffect: 'machine-state'`; the
  grblHAL and FluidNC wrappers (`grblhal/driver.ts:44-60`, `fluidnc/driver.ts:45-54`) add only
  read-only reports, Home and `$NVX`. Nothing names a run-file, run-macro, format or delete
  command.
- **Anchor:**
  - Contract: ADR-293 Consequences (`DECISIONS.md:17596-17597`): "Multiline or
    controller-resident programs require a separate decision and may not bypass the ordinary
    Frame/Start path." WORKFLOW F-B13b Edge 1 ("A macro is a named manual Console command, not a
    job") and Edge 4 (controller-resident macro programs outside v1). ADR-375 decision 9:
    `$DWNGRD` "joins the blocked persistent commands" because it rewrites non-volatile storage.
  - Ground truth:
    - grblHAL Plugin_SD_card `fs_stream.c` L913-925: `$F=<filename> - run file`,
      `$FF=yes - format file system`, `$FD=<filename> - delete file`.
    - FluidNC v4.0.3 `FileCommands.cpp` L661-677: `LocalFS/Format` (`ESP710`), `LocalFS/Run`
      (`ESP700`), `LocalFS/Delete`, `SD/Run` (`ESP220`); `runFile` (L249-264) nests the file as a
      job and returns `Ok` at once. `ProcessSettings.cpp` L1041 `RM`/`Macros/Run` runs a
      configured macro (L688-697). FluidNC loads its machine configuration from the local file
      system (`Machine/MachineConfig.cpp` L205-207 `FileStream(…, LocalFS)`, default name
      `config.yaml` in `SettingsDefinitions.cpp` L98), so `LocalFS/Format` or
      `LocalFS/Delete=config.yaml` removes it; the next boot falls back to defaults in
      `ConfigAlarm` (L198-200).
  - Sibling: C6-P3-3 (Smoothieware `M1000` shell file commands and `M500` pass the Console).
- **Scenario:**
  - A user macro "Run SD job" with template `$SD/Run=job.nc` (FluidNC) or `$F=job.nc` (grblHAL
    with the SD plugin), or `$RM=0`, is one line. It passes `prepareConsoleCommand` as `gcode`,
    gets `ok`, and the controller then runs a whole program, beam included, that KerfDesk never
    framed, reviewed or owns. Only the Live Motion popup's ABORT MOTION covers it.
  - `$LocalFS/Format=FORMAT`, `[ESP710]FORMAT` or `$LocalFS/Delete=config.yaml` on FluidNC, or
    `$FF=yes` on grblHAL, is sent with no confirmation, while `$DWNGRD` and `$RST=` are blocked as
    persistent.
  - Each needs the operator to type or save the command; the risk is that the macro feature and
    the "one Console command" label present a program run as a single command.
- **Evidence:** REPRO (same temporary core test, `-t "file-system"`).
  - grblHAL: `$F=job.nc`, `$FF=yes`, `$FD=job.nc` → `kind:"gcode"`, `confirm:false`,
    `effect:"machine-state"`. `$F+` (a read-only listing) is also `machine-state`.
  - FluidNC: `$SD/Run=job.nc`, `$LocalFS/Run=job.nc`, `[ESP220]job.nc`, `[ESP700]job.nc`,
    `$RM=0`, `$Macros/Run=0` (sent as `$RM=0`), `$LocalFS/Format=FORMAT`, `[ESP710]FORMAT`,
    `$LocalFS/Delete=config.yaml` → each `gcode`, `confirm:false`, `effect:"machine-state"`.
- **Refuter:** CONFIRMED (REPRO + SOURCE) as behaviour. P3 kept. The contract half is
  interpretive.
  - Repro (temporary core test, since deleted):
    - grblHAL driver: `$F=job.nc`, `$FF=yes` and `$FD=job.nc` each come out as `gcode`,
      `confirm:false`, `machine-state`, while `$DWNGRD` is refused.
    - FluidNC driver: `$SD/Run=job.nc`, `$LocalFS/Run=job.nc`, `[ESP220]job.nc`,
      `[ESP700]job.nc`, `$RM=0`, `$Macros/Run=0` (wire `$RM=0`), `$LocalFS/Format=FORMAT`,
      `[ESP710]FORMAT` and `$LocalFS/Delete=config.yaml` each come out the same way, while `$NVX`
      is refused.
  - Source (fetched):
    - grblHAL Plugin_SD_card `master` `fs_stream.c:913-924`: `$F=<filename> - run file`,
      `$FD=` delete and `$FF=yes` format.
    - FluidNC `v4.0.3` `FileCommands.cpp:661,663,666,677`: `LocalFS/Format` (`ESP710`),
      `LocalFS/Run` (`ESP700`), `LocalFS/Delete` and `SD/Run` (`ESP220`).
  - Contract (read ADR-293 myself, `DECISIONS.md:17531`). The Consequences bullet says
    multiline or controller-resident programs "require a separate decision and may not bypass the
    ordinary Frame/Start path". That bullet is written about the macro feature. WORKFLOW F-B13
    "Edge — arbitrary G-code" allows any single line typed at Idle, and ADR-293 says a saved
    command has "the same physical implications" as typing it.
    - So the typed form is within contract.
    - The macro form contradicts the ADR's Frame/Start sentence only on a strict reading.
    - Format and delete do sit beside `$DWNGRD` (ADR-375 D9) as unblocked non-volatile writes.
  - Severity: P3 is right, and so is "a maintainer decision" as the fix direction.
- **Fix direction:** A maintainer decision. Either give these commands their own class (refuse
  run-file and run-macro, or require a confirmation that names them as an unframed program, and
  block format/delete with the other persistent commands), or amend ADR-293 and WORKFLOW F-B13b
  to say a one-line Console command may start a controller-resident program.

### P3-3 — Error presentation gaps: grblHAL file-system codes and 253 show as a bare number, grblHAL-only codes are not described under a stock-GRBL profile although its alarms are, and two shared codes keep GRBL wording on grblHAL

- **Where:**
  - `src/core/controllers/grbl/grblhal-error-codes.ts:11-62` covers 18, 19, 39-58, 71-84, 86-88
    and 90-92, but not 60-66, 70, 85, 89 or 253.
  - `src/core/controllers/grbl/response-presentation.ts:165-173`. `presentError` uses the grblHAL
    table only when the driver kind is `grblhal`; a `grbl-v1.1` profile gets `describeError` only.
  - Twin: `src/core/controllers/grbl/alarm-codes.ts:235-241` deliberately falls back to the
    grblHAL meanings for alarms 11-22 on a stock profile ("rather than showing 'unknown' on a
    mislabeled profile").
  - `src/core/controllers/grbl/error-codes.ts:37-40` (`error:6` "must be ≥ 3 µs") and `:153`
    (`error:38` "Reduce the tool number.").
- **Anchor:** Ground truth.
  - grblHAL `errors.h` defines 60-66 (SD/file system), 70 (Bluetooth init), 85 (format failed),
    89 (delete failed) and 253 (`Status_UserException`); `errors.c` gives 253 "User defined error
    occured." and the plugins register the rest (`sdcard.c` L231-232 "SD Card mount failed.",
    "SD Card not mounted."; `fs_stream.c` "Directory listing failed.", "File system format
    failed.", "Delete failed.").
  - grblHAL `errors.c` words the shared codes differently: 6 "Step pulse time must be greater or
    equal to 2 microseconds", 38 "Tool number greater than max supported value or undefined tool
    selected".
  - Twin: the alarm table's stock-profile fallback.
- **Scenario:**
  - grblHAL with the SD plugin, Console `$F=job.nc` with no card mounted: the plugin answers
    `error:65` (`fs_stream.c` returns `Status_FsNotMounted`, text "File system not mounted.",
    L939), and the transcript says only `Error 65`.
  - A grblHAL board under a generic GRBL profile (grblHAL can greet as `Grbl 1.1f`, HF-8) answers
    `error:52` (setting out of range) or `error:79` (critical event): the transcript shows
    `Error 52`/`Error 79`, while the same board's `ALARM:12` is decoded with its grblHAL meaning.
  - On grblHAL, `error:6` tells the operator that 2.5 µs is too short, and `error:38` for an
    undefined tool says to reduce the number.
  - Display only; nothing is decided from these texts.
- **Evidence:** REPRO and SOURCE.
  - Same temporary core test, `-t "presentation"`: `presentError('grblhal', n)` was `null` for
    60, 61, 62, 64, 65, 66, 70, 85, 89, 253; `presentError('grbl-v1.1', 79)` was `null` while
    `presentAlarm('grbl-v1.1', 12)` was "Limit switch engaged (grblHAL)".
  - Scripted diff of `grblhal-error-codes.ts` against `errors.c`/`errors.h` at `d7aaee3`
    (a throwaway node script, not kept): every described code matches verbatim except a trailing
    period on 18 and 19; the uncovered ids are exactly those listed above.
- **Refuter:** CONFIRMED (REPRO + SOURCE). P3 kept.
  - Repro (temporary core test, since deleted):
    - `presentError('grblhal', n)` was `null` for 60-66, 70, 85, 89 and 253.
    - `presentError('grbl-v1.1', 52)` and `presentError('grbl-v1.1', 79)` were `null`, while
      `presentAlarm('grbl-v1.1', 12)` returned "Limit switch engaged (grblHAL)".
    - `presentError('grblhal', 6)` was "must be ≥ 3 µs", and `presentError('grblhal', 38)` was
      "Reduce the tool number."
  - Source: grblHAL core `d7aaee3` (fetched).
    - `errors.h:93-99,101,120,124,129` define 60-66, 70, 85, 89 and 253.
    - `errors.c:36` words 6 as "greater or equal to 2 microseconds", `:68` words 38 as "max
      supported value or undefined tool", and `:109` words 253 as "User defined error occured."
  - Display only, so P3.
- **Fix direction:** Add the plugin and 253 texts to the grblHAL table, fall back to it for codes
  above 38 on a stock profile (as the alarm table does), and give `error:6`/`error:38` a grblHAL
  detail.

## KNOWN (re-observed, not re-raised)

- **K-1 — rolling-v2 17-P3-2.** A leading or interior `/` passes `$RST=*` and `$30=` as G-code
  (re-observed: grblHAL control run, `/$RST=*` → `gcode`). P3-1 is the comment form of the same
  root cause and needs the comment strip that 17-P3-2's fix direction omits.
- **K-2 — C4-P3-1.** `$22.0=`, `$+22=` pass as G-code. `(x)$22=0.5` (P3-1) is a further spelling.
- **K-3 — C4-P2-1.** grblHAL Console `$N=` values are unchecked. Also `$100=8 0`: the Console keeps
  the interior space (`normalizeConsoleInput`), and grblHAL's `read_float` stops at it and stores 8.
- **K-4 — C6-P3-1 (raised concurrently by C6).** FluidNC's bracket form bypasses the Console.
  Extra evidence from this audit: through the real store on a FluidNC session, `[RST]#`, `[NVX]`
  and `[13]1` each reached the wire (`lastWriteError:null`, `reportUnitsUnconfirmed:false`) where
  `$RST=#`, `$NVX` and `$13=1` were refused; `normalize-external-program.ts:246` already refuses
  the bracket form in opened programs ("FluidNC runs as a $ command").
- **K-5 — 2026-07-13 CNC spindle/auxiliary audit §9.14.** The Console sends M3/M4/M7/M8 while Idle
  without confirmation. Still true, and allowed by WORKFLOW F-B13 "Edge — arbitrary G-code" and
  ADR-293 Consequences. Since then accessory evidence is invalidated (`hasAccessoryCommand`). Note
  for the maintainer: GRBL laser mode keeps M3 power "regardless if the machine is moving,
  accelerating, or stopped" (Laser Mode wiki), so `G1 M3 S1000` lights the beam statically at
  full scale. ADR-162 caps Fire at 5% and makes it momentary; the Console is outside that ADR.

## Refuted

The refuter refuted none of the four raised findings (P2-1, P3-1, P3-2 and P3-3 are all
CONFIRMED). It did correct two scenario details: P2-1's window is about 100 s, and in P3-1
`$RST=*`'s reboot clears the evidence. Candidates this audit dropped itself:

- **Lone `!` refused.** By design: the reason text sends the operator to Pause, and Live Motion
  offers ABORT MOTION for unowned motion.
- **grblHAL `$HELP <topic>` broken by space stripping.** grblHAL `system_execute_line` (L1155-1159)
  removes spaces before `=` itself, so `$HELPhoming` is the same command.
- **Macro selection silently switching to another macro after a storage event.** The selector
  renders `model.selected.name`, the same macro Run uses.
- **FluidNC verbose errors break `error:N` parsing.** FluidNC prints `error:N` and then a separate
  `[MSG:ERR: …]` line (`Channel.cpp` L266-280).
- **External programs with DEL edit lines on grblHAL.** `normalize-external-program.ts:88-89`
  refuses DEL; KerfDesk output never contains it.
- **ALARM:5 wording for G38.4.** KerfDesk follows the upstream CSV and wiki text.
- **UI vs store gate for `M5`/`M9` recovery under MPG takeover.** The store exempts them; the deck
  still requires Idle and no job. Kept under Not verified: no user flow traced.

## Verified clean

- **Realtime and control bytes** (repro): `?` alone → `realtime-status`, wire `?`, no ack, allowed
  during a job; `~` alone → cycle start, refused during any operation; `!` anywhere and `?`/`~`
  inside a line refused with their realtime meaning; `0x18`, `0x85`, `0x91` refused; U+00A0 → space.
  Macros refuse C0, DEL, C1, U+2028/2029 and non-ASCII at save time and re-validate stored records.
- **Spelling** (repro): `$rst = *`, `$RST=&` blocked; `$slp`, `$hx` → Idle-or-Alarm; `m3 s1000`,
  `M 3 S 1 0 0 0` → `accessories`; `G1 M3 S1000` → `machine-state`; `$J=G91 X10 F1000` Idle-only.
- **Gates:** setting writes need confirmation, fresh Idle, no operation and the store re-check
  after the async wait; `$H`/`$SLP` Idle or Alarm; `$C` Idle or Check; `$X` in any state outside
  an operation; the reset-required latch refuses everything but `?`; a job (streaming, paused,
  tool-change, done, errored) refuses everything but `?`. MCP has no Console path
  (`electron/mcp/machine-schemas.ts:56`: "no arbitrary console, G-code, laser firing or file
  exchange"), and no remote or MCP module calls `sendConsoleCommand` or `prepareConsoleCommand`
  (grep of `src/` and `electron/`).
- **Macros (ADR-293):** one line, numeric-only variables (`^[+-]?(\d+(\.\d*)?|\.\d+)$`, finite),
  expansion goes through `runConsoleCommand` → `sendConsoleCommand`; no import/export path exists
  (grep of `USER_MACRO_STORAGE_KEY`).
- **Error and alarm tables:** GRBL errors 1-38 and alarms 1-10 match `error_codes_en_US.csv`,
  `alarm_codes_en_US.csv` and the Interface wiki tables; the GP-8 corrections (ALARM:4 both
  directions, error:7 both stores, error:11 79 characters) are in place. grblHAL alarms 10-22
  match `alarms.c`; the critical alarms (1, 2, 10, 17, 20 per `alarm_is_critical`) carry reset
  or power-cycle advice. FluidNC errors (83 named, 172 unnamed) and alarms 1-18 match `25ae119b` exactly
  (scripted diff with a throwaway node script, not kept). `error:N` and `ALARM:N` are numeric on all three.
- **Build info:** `[VER:1.1x.YYYYMMDD:…]` and `[OPT:<codes>,<blocks>,<rx>]` follow GRBL
  `report_build_info` order `VNMCPZHTAD0SRL+*$#IEW2`; the RX field becomes a session-bound window
  of `min(profile, rx − 8)` (`grbl-streaming.ts:64-71`, `resolveStartStreamWindow`); grblHAL and
  FluidNC never send `$I`, so their variant output cannot pass as stock proof.
- **`$32`:** grblHAL "Normal,Laser mode,Lathe mode" (`settings.c` L2399), FluidNC
  `INT_PROXY("32", "Grbl/LaserMode", spindle->isRateAdjusted())` (L146), GRBL bit flag;
  `parseGrblMachineMode` maps 0/1/2 and keeps anything else unrecognized.
- **Line limits and scans:** GRBL `LINE_BUFFER_SIZE 80` → 79 significant characters after
  dropping ≤ space, `/`, comments and realtime bytes; grblHAL `257` → 256 with inner spaces and
  comments counted and leading blanks dropped; both match the fetched `protocol.c` loops.
  `sendable-line-scan` matches the streamer's `splitLines` (trim, `;` lines, +1 newline).
- **Transcript copy:** TSV cells escape `\`, CR, LF and tab.

## Not verified

- No hardware run. Every repro is a fake session or a pure call.
- grblHAL `$TLR`/`$TPW` (tool length reference and tool probe) are classified `machine-state`,
  which keeps work-Z evidence while the tool length offset changes; the effect on CNC Start was
  not traced.
- grblHAL `G65` macro calls (NGC expressions/macros plugin) were not checked against source.
- Whether FluidNC strips `( … )` before its `$`/`[` dispatch, which would extend P3-1 to FluidNC.
- Whether any UI shows a beam lit by a Console M3 (C8 area).
- The UI/store difference for `M5`/`M9` under MPG takeover (store `console-command-readiness.ts:36-43`
  vs `console-command-availability.ts:108-129`).

```json
[
  {"id":"C5-P2-1","severity":"P2","area":"ctl-console-responses","file":"src/ui/laser/super-console/diagnostic-bundle.ts","line":64,"anchor":"Contract: the bundle's own disclosure 'raw settings values' omitted (diagnostic-bundle.ts:188) and panel text 'numeric settings'; Ground truth: grblHAL setting_get_value prints Format_Password ($75,$77,$330,$331,$533) in clear over serial; Twin: 27-P2-3 / PR #1364 redact the support report","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO real store+bundle (grblHAL $75/$77/$533 verbatim) + SOURCE grblHAL settings.c:1961; PR #1364 touches only src/ui/support, not the bundle; window ~100 s; P2 kept","known":"related: rolling-v2 27-P2-3 (support report), C4-P3-7 (backup/snapshot); corrects C4-P3-7's twin note","summary":"Super Console diagnostic bundle (transcript on by default) carries raw $$ reply lines and typed $N= writes, so grblHAL Wi-Fi/AP/MQTT passwords land in the support file while its disclosure says raw settings values are omitted"},
  {"id":"C5-P3-1","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/grbl/console-command.ts","line":79,"anchor":"Ground truth: gnea/grbl protocol.c L113-148 strips ( ) and ; comments before the L96 line[0]=='$' dispatch; Contract: ADR-362 D1, WORKFLOW F-B13, ADR-180 Amd 6, GP-1 fix; Twin: normalize-external-program.ts:127-139 strips comments before its $ check","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO prepareConsoleCommand + SOURCE gnea/grbl protocol.c L96/L120-131; correction: $RST=* reboots (mc_reset) so the banner clears evidence; P3 kept","known":"related: rolling-v2 17-P3-2 ('/' form; its fix direction does not strip comments)","summary":"Stock GRBL: (x)$RST=*, $RST(x)=*, (x)$N0=, (x)$I=, $32(x)=0 and (x)$13=1 pass as unconfirmed G-code with no block, $32 rule, value check, units or $$ re-read; $H ;home skips the post-homing WCS re-read (GP-1 outcome)"},
  {"id":"C5-P3-2","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/grbl/console-command.ts","line":103,"anchor":"Contract: ADR-293 Consequences (controller-resident programs may not bypass Frame/Start), WORKFLOW F-B13b Edge 1/4, ADR-375 D9 (persistent NVS writes blocked); Ground truth: grblHAL fs_stream.c $F=/$FF=/$FD=, FluidNC FileCommands.cpp SD/Run, LocalFS/Run, LocalFS/Format, LocalFS/Delete, ProcessSettings.cpp RM","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO grblHAL/FluidNC drivers + SOURCE fs_stream.c:913-924, FileCommands.cpp:661-677; ADR-293 clause is macro-scoped, typed form allowed by F-B13 Edge; P3 kept, maintainer decision","known":"sibling: C6-P3-3 (Smoothieware M1000 shell / M500)","summary":"Controller file-system commands ($F=job.nc, $SD/Run=, $LocalFS/Run=, [ESP220], $RM=0, $LocalFS/Format, [ESP710], $FF=yes) are one ordinary unconfirmed Console line, so a one-command macro can start an unframed controller-resident program or format the controller FS"},
  {"id":"C5-P3-3","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/grbl/response-presentation.ts","line":172,"anchor":"Ground truth: grblHAL errors.h/errors.c d7aaee3 (60-66,70,85,89,253; wording of 6 and 38), Plugin_SD_card sdcard.c/fs_stream.c texts; Twin: alarm-codes.ts:235-241 falls back to grblHAL meanings on a stock profile","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO presentError/presentAlarm + SOURCE grblHAL errors.h/errors.c d7aaee3; P3 kept","known":false,"summary":"grblHAL FS/BT plugin errors 60-66,70,85,89 and 253 show as a bare 'Error N'; grblHAL-only codes (e.g. 52, 79) are undescribed under a stock-GRBL profile while alarms 11-22 fall back; error:6/38 keep GRBL wording on grblHAL"},
  {"id":"C5-K-1","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/grbl/console-command.ts","line":79,"anchor":"Ground truth gnea/grbl protocol.c ignores '/'","evidence":"REPRO","verdict":"KNOWN","known":"rolling-v2 17-P3-2","summary":"Leading/interior '/' passes $RST=* and $30= as G-code (re-observed)"},
  {"id":"C5-K-2","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/grbl/console-command.ts","line":62,"anchor":"Ground truth gnea/grbl system.c read_float setting id","evidence":"READ","verdict":"KNOWN","known":"controller-v2 C4-P3-1","summary":"$22.0=, $+22= pass as G-code (re-observed)"},
  {"id":"C5-K-3","severity":"P2","area":"ctl-console-responses","file":"src/core/controllers/console-setting-writes.ts","line":182,"anchor":"Ground truth grblHAL settings_store_setting / read_float","evidence":"READ","verdict":"KNOWN","known":"controller-v2 C4-P2-1","summary":"grblHAL Console $N= values unchecked; also $100=8 0 keeps the interior space and grblHAL stores 8"},
  {"id":"C5-K-4","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/fluidnc/fluidnc-command-names.ts","line":106,"anchor":"Ground truth FluidNC v4.0.3 ProcessSettings.cpp L1209-1240","evidence":"REPRO","verdict":"KNOWN","known":"controller-v2 C6-P3-1 (concurrent)","summary":"FluidNC [RST]#, [NVX], [13]1 reach the wire through the real store where the $ forms are refused"},
  {"id":"C5-K-5","severity":"P3","area":"ctl-console-responses","file":"src/core/controllers/console-state-effect.ts","line":97,"anchor":"Contract WORKFLOW F-B13 Edge (arbitrary G-code allowed when Idle); Ground truth GRBL Laser Mode wiki (M3 holds power when stopped)","evidence":"REPRO","verdict":"KNOWN","known":"2026-07-13 CNC spindle/auxiliary audit §9.14","summary":"Console M3/M4 with S>0 is Idle-only but unconfirmed; G1 M3 S1000 lights a GRBL laser statically at full scale, outside ADR-162's 5% Fire cap (by contract; maintainer note)"}
]
```
