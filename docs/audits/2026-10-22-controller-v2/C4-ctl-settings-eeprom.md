# Controller audit v2 — C4 Settings and EEPROM (`ctl-settings-eeprom`)

- **When:** 2026-10-22 09:10   **Tree:** origin/main @ `99a2e64b7` (audit worktree HEAD `a2a5f67f8`;
  only audit docs differ from `99a2e64b7`)
- **Scope:**
  - Core: `src/core/controllers/grbl/grbl-setting-definitions.ts`, `grbl-setting-number.ts`,
    `grbl-setting-storage.ts`, `grbl-setting-write.ts`, `grbl-settings.ts`, `eeprom-write-line.ts`,
    `compare-settings-snapshots.ts`, `parse-settings.ts`; followed into `response.ts` (`$N=` line
    classification), `console-command.ts` (setting-write classification) and
    `src/core/controllers/console-setting-writes.ts`.
  - Store: `src/ui/state/grbl-settings-actions.ts` (`readMachineSettings`, `writeGrblSetting`),
    `machine-settings-write-readiness.ts`, `machine-settings-read-readiness.ts`,
    `grbl-settings-evidence.ts`, `laser-console-actions.ts`, `laser-console-settings-write.ts`.
  - UI: `src/ui/laser/MachineSettingsPanel.tsx`, `export-grbl-settings-backup.ts`,
    `machine-settings-presentation.ts`, `device-setup/DeviceSetupFirmwareStep.tsx`,
    `device-setup/device-setup-firmware-diff.ts`, `device-setup/use-machine-setup-save.ts`,
    `job-review/SendRouterModeButton.tsx`, `super-console/SuperConsoleSnapshotCompare.tsx`,
    `src/io/controller-settings-snapshot.ts`.
  - Governing: ADR-092 (guarded firmware sync), ADR-205 (Machine Setup: only common settings use the
    read/backup/confirm/queue/save/write/re-read/verify path), ADR-375 decision 9 (C-4 Console setting
    values), ADR-180 Amendment 6 (`$32` per machine kind), ADR-644 (EEPROM lines stream alone),
    ADR-648 (owned-reset settings), WORKFLOW F-B14 (Machine Settings read-only backup).
- **Lenses run:** L1, L2, L3, L4, L5, L6, L7 as separate passes. L5 covered the snapshot import (the
  only settings file KerfDesk reads back) and what the exported files carry.
- **Primary sources fetched this session:**
  - gnea/grbl `bfb67f0` `settings.c` (`settings_store_global_setting`), `system.c`
    (`system_execute_line`), `report.c` (`report_grbl_settings`), `nuts_bolts.c` (`read_float`),
    `protocol.c`.
  - grblHAL core `d7aaee3` (the commit the code itself pins): `settings.c`
    (`settings_store_setting`, `setting_validate_me_uint`, `validate_value`, `setting_get_value`,
    setting detail table), `nuts_bolts.c` (`read_uint`, `read_float`), `system.c`
    (`system_execute_line`), `report.c` (`report_setting`, `print_setting`, `report_grbl_settings`),
    `protocol.c` (line assembly).
  - FluidNC `fdc17a2` `ProcessSettings.cpp` (`show_settings`, `switchInchMM`, `list_settings`),
    `SettingsDefinitions.cpp` (`make_proxies`), `Logging.h`.
  - GRBL v1.1 configuration wiki (`$13`, `$20`, masks, EEPROM persistence).
- **Counts:** 9 raised → refuter: 9 confirmed, 0 plausible, 0 refuted → P1 0 / P2 1 / P3 8
  (+ 3 KNOWN re-observed). No severity changes. P2-1 detail corrected: `$22=1.0` reads back as
  `$22=0` with soft limits also forced off, and the `.0` part affects grblHAL builds before
  20261015 only.

## Headline

There is no restore. WORKFLOW F-B14 makes backup an export-only lane ("No Load-from-backup button"),
so the restore-order, read-only-skip and cross-machine questions have no code path to fail. The
guarded Machine Settings writer is sound for what the UI sends it (`$30`/`$31`/`$32`): strict decimal
encoding, Idle-only, readback-verified.

The real gap is the Console on grblHAL. ADR-375 decision 9 leaves grblHAL values to the firmware
because "grblHAL refuses such values itself". At the commit the code pins, it does not:

- `settings_store_setting` stores the numeric prefix of a malformed value, so `$100=26,67` stores 26
  and `$110=5O00` stores 5.
- `read_uint` multiplies a zero fraction, so `$1=25.0` stores 250 and `$22=1.0` stores 10, which
  clears the homing Enable bit.

KerfDesk sends the line as typed and gets `ok`. Its `$$` re-read then updates the table without
comparing it with what was typed, so nothing tells the operator that the value they confirmed is not
the one stored.

## Settings flow map

| Flow | Entry | Validation | Lines sent | Verification |
|---|---|---|---|---|
| Read | Machine Settings **Read ($$)**, Machine Setup, Super Console, post-reset requalification | `machineSettingsReadBlockReason`: connected, no job/motion/fire/autofocus/operation/pending write, Idle or exact Alarm | `$$`, then `$I`, `$G` | collector ends on first `ok` after ≥1 `$N=` line |
| Guarded write | Machine Setup Review → queued `$30`/`$31`/`$32` (`writable` = encodable and `writeRisk === 'common'`); Job Review **Send router mode** (`$32=0`) | `machineSettingsWriteBlockReason` (read gate, Idle, read this connection, known non-read-only row, ADR-180 `$32` rule, stock-GRBL 8-bit storage) and `encodeGrblSettingValue` (strict decimal, parser-precision and HAL integer rules) | `$id=value`, then `$$` | `settingReadbackMatches` at the printed precision; mismatch throws |
| Console write | Console / macros, `$N=` | confirmation, fresh Idle, no active job (incl. tool-change hold), ADR-180 `$32` rule, stock GRBL only: `stockGrblSettingStorageIssue`; Falcon: `$150–$152` whole numbers; FluidNC: refused | the typed line | `$$` re-read, no comparison |
| Backup | Machine Settings **Export backup** | rows read this connection | none | — |
| Snapshot A/B | Super Console **Compare two controller snapshots** | strict schema on load (2 MB, keys, duplicate ids) | none | display only |
| Restore | — | — | — | does not exist (WORKFLOW F-B14 non-goal) |

## Findings

### P2-1 — Console `$N=` writes on grblHAL are not checked, and grblHAL silently stores a different value for malformed input

- **Where:**
  - `src/core/controllers/console-setting-writes.ts:38`. For every `grbl-dollar` driver other than
    stock GRBL (that is, grblHAL, `grbl/driver.ts:49` inherited by `grblhal/driver.ts`) the value is
    "left to the firmware" (`: null`).
  - The premise is in the header comment (`:15-21`) and ADR-375 decision 9
    (`docs/decisions/ADR-375-controller-audit-2-open-findings.md:236-237`): "grblHAL refuses such
    values itself".
  - `src/ui/state/laser-console-settings-write.ts:50-80`. `rereadSettingsAfterConsoleWrite` re-reads
    `$$` but never compares the stored value with the typed one.
- **Anchor:**
  - Ground truth: grblHAL core `d7aaee3`.
    - `settings.c` `settings_store_setting` (L3548-3552) calls `read_float` / `read_uint` and then
      validates the parsed number. It never checks that the whole value was consumed. `read_float`
      and `read_uint` (`nuts_bolts.c`) stop at the first non-digit.
    - `read_uint` adds a zero fractional digit to the accumulator, failing only
      `if (isdecimal && c != 0)`, so `25.0` becomes 250.
    - `system.c` `system_execute_line` copies everything after `=` verbatim. `protocol.c` keeps
      `,` and letters in `$` lines.
    - Stock GRBL is strict: `system.c:270` refuses any trailing character
      (`if((line[char_counter] != 0) ...) return(STATUS_INVALID_STATEMENT)`).
  - Contract: ADR-375 decision 9 says the Console refuses a value the firmware would store as
    something else. It exempts grblHAL on a false premise.
  - Twin: the Machine Settings lane refuses the same inputs
    (`encodeGrblSettingValue`, `grbl-setting-number.ts:88-97`, "Enter a finite decimal number"). It
    sends `25` for HAL integer settings typed `25.0` (`:65-86`, written for exactly this `read_uint`
    behaviour), and it verifies the readback (`grbl-settings-actions.ts:284-291`).
- **Scenario:** grblHAL profile, Console, the operator confirms the write.
  - `$100=26,67` (locale comma for 26.67 steps/mm): grblHAL stores 26. X then moves 26/26.67 of every
    commanded distance, so parts come out about 2.5 % short.
  - `$110=5O00` (letter O): grblHAL stores a 5 mm/min maximum rate.
  - `$1=255.0`: grblHAL stores 2550 ms, so the steppers release after 2.55 s instead of holding.
  - `$22=1.0`: grblHAL stores 10, which clears the homing Enable bit (XBitfield, 11 options, so 10 is
    in range).
  - `$3=1.0` on a 4-axis build stores 10, which inverts Y and A instead of X.
  - In each case the reply is `ok`, the `$$` re-read shows the stored value in the table, and no
    error, toast or log line says it differs from the typed command. The same inputs on stock GRBL
    are refused (`error:3`), or caught by KerfDesk first.
- **Evidence:** REPRO and SOURCE.
  - Command (temporary test, since deleted):
    `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-c4-console-hal.test.ts --silent=false`.
    6 passed.
  - The real `grblHal.prepareConsoleCommand` and `consoleSettingWriteIssue` returned
    `kind:"setting-write"`, `consoleIssue:null` and `wire:"$100=26,67\n"` (likewise `$110=5O00`,
    `$1=25.0`, `$22=1.0`, `$26=25.0`).
  - A line-for-line port of grblHAL `read_float` / `read_uint` gave stored values 26, 5, 250, 10 and
    250. `encodeGrblSettingValue(…, 'grblhal')` gave `blocked` for the first two and `"25"` / `"1"`
    for the `.0` forms.
  - Real store, fake grblHAL session (`connect(..., {controllerKind:'grblhal'})`, banner
    `GrblHAL 1.1f`): `sendConsoleCommand('$100=26,67', {confirmed:true})` wrote `$100=26,67\n`, then
    `$$\n`. After `$100=26.000`, the end state was `row100:"26.000"`, `lastWriteError:null` and
    `qualification:"qualified"`. The only log line was `[lf2] Controller settings read (2).`.
- **Refuter:** CONFIRMED (REPRO + SOURCE). Severity P2 stands.
  - Sources fetched by the refuter: grblHAL core `d7aaee3` and `master` (build 20261015, `62f25d4`).
    - `settings.c` `settings_store_setting` (`d7aaee3` L3527-3552, master L3577-3602): it parses
      with `read_float` / `read_uint` and never checks that the value was consumed, on both
      commits.
    - `validate_value` (L3271) only range-checks. `$100`/`$110` are `Format_Decimal` with no
      minimum (L2452-2453), and `set_axis_setting` only checks step pulse width, which a smaller
      value passes.
    - `nuts_bolts.c` `read_uint` (`d7aaee3` L195-244) and `read_float` (L253-315) stop at the first
      non-digit.
    - `system.c` `system_execute_line` (L1140-1220) uppercases only the part before `=` and passes
      `args` verbatim to `settings_store_setting` (L1210-1211).
    - `protocol.c` (L290-327) keeps `,` and letters in a `$` line.
  - `26,67` → 26 and `5O00` → 5: confirmed on `d7aaee3` and on master. grblHAL answers `ok`, with
    no error.
  - `25.0` → 250 and `1.0` → 10: confirmed on `d7aaee3` only.
    - At `d7aaee3`, `read_uint` multiplies a zero fractional digit into the integer. It fails only on
      a non-zero one (`$22=0.5` gets `Status_GcodeCommandValueNotInteger`).
    - `read_uint` is identical at `16e5df9` (2026-02), so every grblHAL build before 20261015 has
      the bug.
    - Master's `read_uint` (changelog 20261015, "hardening" from unit tests) skips fractional
      zeros, so `25.0` → 25 there.
    - KerfDesk cannot tell which build is connected, so the Console exposure stands.
  - Correction to the scenario: `$22=1.0` parses to 10, but at `d7aaee3` `set_homing_enable`
    (`settings.c` L1201) sees the Enable bit clear, forces soft limits off and stores 0. The
    readback is therefore `$22=0`, with homing and soft limits both off, not 10.
  - Other scenarios:
    - `$1=255.0` → 2550 is valid: `$1` is `Format_Int16`, max 65535 (L2343).
    - `$3=1.0` → 10 is refused on a 3-axis build (`AxisMask` must be < 8). It lands only on 4+ axes,
      as stated.
  - KerfDesk repro (temporary `src/ui/state/zz-c4r-console-hal.test.ts`, since deleted):
    - The store was connected with `{controllerKind:'grblhal'}`, banner `GrblHAL 1.1f`; active and
      detected kind were both `grblhal`.
    - `sendConsoleCommand` with `$100=26,67`, `$22=1.0` and `$1=255.0` (`confirmed:true`) wrote
      each typed line, then `$$`.
    - After the readbacks `$100=26.000` and `$22=0`, the end state was `lastWriteError:null` and
      `qualification:"qualified"`. The log said only `Controller settings read`.
    - `rereadSettingsAfterConsoleWrite` uses `written` only in its `catch`.
    - `runConsoleCommand` adds only the generic "Send persistent controller setting?" prompt.
  - ADR-375 decision 9 (L232-238): "grblHAL refuses such values itself" holds for non-zero
    fractions and out-of-range values. It does not hold for trailing characters (any build) or `.0`
    (pre-20261015).
  - Why P2 and not P1: the trigger is a malformed value typed into the raw Console behind a
    confirmation, and the re-read table does show the stored value. Still, an `ok` silently changes
    scale or homing/soft limits.
- **Fix direction:** For grblHAL `$N=` in the Console, apply the Machine Settings lane's value check:
  a strict finite decimal, the HAL integer rule (refuse `.0`, or send the integer), and line length.
  Also compare the `$$` readback with the typed value, as `settingWasVerified` does. Correct ADR-375
  decision 9's grblHAL sentence, and add a grblHAL test with a malformed value (the only grblHAL test,
  `console-setting-writes.test.ts:18-20`, uses `$110=6000`).

### P3-1 — A float-spelled setting number (`$22.0=`, `$+22=`, `$32.0=`) passes the Console as plain G-code

- **Where:**
  - `src/core/controllers/grbl/console-command.ts:62,88`. `SETTING_WRITE_RE = /^\$\d+=\S.*$/`
    decides `setting-write`; anything else falls through to `gcode` with `requiresConfirmation:false`.
  - `src/core/controllers/grbl/grbl-setting-write.ts:88`. The ADR-180 `$32` rule's
    `/^\$(\d+)\s*=/` does not match either.
  - `src/ui/state/laser-console-settings-write.ts:26`.
- **Anchor:**
  - Ground truth: gnea/grbl `system.c:252-253,271` reads the setting number with `read_float`, then
    stores `(uint8_t)parameter`, so `$22.0=0.5` and `$+22=0.5` store `$22`. grblHAL `system.c`
    accepts any `read_float` parameter with `isintf`.
  - Contract: ADR-375 decision 9 (stock-GRBL storage check, every write re-read). ADR-180
    Amendment 6 (`$32` per machine kind).
  - Twin: `eeprom-write-line.ts` `isStoredSettingWriteLine('$22.0=0.5')` is `true` (ADR-648 sees
    the write); the Console classifier does not.
- **Scenario:** On stock GRBL, `$22.0=0.5` is sent with no confirmation and no storage refusal.
  `$22=0.5` is refused with "0.5 would turn it off". GRBL then stores 0, which turns homing and soft
  limits off.
  - No `$$` re-read follows, so the snapshot keeps showing homing enabled. The Frame evidence is
    voided as `machine-state`, but the settings evidence is not.
  - On a router, `$32.0=1` gets past the ADR-180 refusal of `$32=1`.
  - Needs deliberate odd spelling. This is a sibling of rolling-v2 17-P3-2 (leading `/`).
- **Evidence:** REPRO.
  - Command (temporary, since deleted):
    `node ../../../node_modules/vitest/vitest.mjs run src/core/controllers/grbl/zz-c4-core.test.ts --silent=false`.
  - `$22=0.5` gave `kind:"setting-write"`, `confirm:true` and the storage issue.
  - `$22.0=0.5`, `$+22=0.5` and `$22.=0.5` each gave `kind:"gcode"`, `confirm:false`,
    `stateEffect:"machine-state"` and `issue:null`, while `isStoredSettingWriteLine` was `true`.
- **Refuter:** CONFIRMED (REPRO + SOURCE).
  - Temporary `src/ui/laser/zz-c4r-p3.test.ts` (since deleted): `$22.0=0.5`, `$+22=0.5` and
    `$32.0=0` each gave `kind:"gcode"`, `confirm:false`, a `null` stock-GRBL issue and a `null`
    laser `$32` rule, with `isEepromWriteLine` and `isStoredSettingWriteLine` both `true`.
  - `$032=0` is caught (setting-write plus the laser refusal), so only the float spellings slip.
  - gnea/grbl `system.c` L253-254 reads the id with `read_float` and requires `=`. L269-271 store
    `(uint8_t)parameter`.
  - The EEPROM detectors' only runtime users are `streamer.ts` and `laser-owned-reset-settings.ts`.
    No Console guard uses them.
- **Fix direction:** Classify any `$<number>=` that GRBL's `read_float` would read as a setting
  number (sign, trailing `.`, `.0`) as `setting-write` on its integer id, and send its canonical form.
  Otherwise refuse it.

### P3-2 — Empty grblHAL string settings (`$N=`) are dropped from the settings table, backup and snapshot

- **Where:** `src/core/controllers/grbl/response.ts:28`. `SETTING_RE = /^\$(\d+)=(.+)$/` needs at
  least one value character, so `$74=` is classified `unknown` and never reaches the collector
  (`parse-settings.ts:124-128`).
- **Anchor:**
  - Ground truth: grblHAL `report.c` `report_setting` writes `$`, id, `=`, then the value for any
    non-null value. `setting_get_value` returns the string itself for `Format_String` /
    `Format_Password`, which may be empty (unset SSID, hostname or password on network builds).
  - Contract: WORKFLOW F-B14 says unknown settings "remain visible as unknown rows instead of being
    dropped". The export contains "every visible row, including unknown settings".
- **Scenario:** A grblHAL network build with an unset `$74` STA SSID prints `$74=`. The Machine
  Settings table, the `.lfgrbl-settings.json` backup and the `.lfsettings.json` snapshot omit `$74`.
  A later comparison shows "Missing from A" rather than an empty value.
- **Evidence:** REPRO (same temporary core test):
  - `classifyResponse('$74=')` returned `{"kind":"unknown"}`.
  - Collecting `$70=7`, `$74=`, `$71=grblHAL`, `ok` gave rows `[$70,$71]`.
- **Refuter:** CONFIRMED (REPRO + SOURCE).
  - Same temporary test: `classifyResponse('$74=')` returned `{"kind":"unknown","raw":"$74="}`,
    and the collector rows were `[70,71]`.
  - grblHAL `d7aaee3` `report.c` `report_setting` writes `$id=` plus the value whenever
    `setting_get_value` is non-null. For `Format_String`, `setting_get_value` returns the stored
    or getter string, and an empty string is non-null.
  - `settings.h` L130: `$74` is `Setting_WiFi_STA_SSID`.
- **Fix direction:** Accept an empty value (`(.*)`) for `$N=` lines while collecting `$$`. Keep a
  `null` numeric value.

### P3-3 — Machine Setup offers `$32=0` for a laser whose profile has laser mode off; the writer then refuses it after the profile is saved

- **Where:**
  - `src/ui/laser/device-setup/device-setup-firmware-diff.ts:97,126`. `writable` is
    `encoded ok && writeRisk === 'common'`, and the desired `$32` is
    `cnc === null && draft.laserModeEnabled ? 1 : 0`.
  - `src/core/controllers/grbl/grbl-setting-write.ts:76-78`, reached from
    `machine-settings-write-readiness.ts:46`, refuses `$32=0` for a laser.
- **Anchor:** Twin. The comparison's `writable` against the writer's
  `grblSettingMachineKindIssue` (ADR-180 Amendment 6). ADR-205 says firmware writes are offered only
  for settings the guarded path will write.
- **Scenario:** In Machine Setup for a laser, the operator clears the Laser mode checkbox
  (`DeviceProfilePowerFields.tsx:76-80`, hosted by `DeviceSetupMachineStep`). The controller
  reports `$32=1`.
  1. Review shows "$32 Laser mode — controller 1 → profile 0" with "Confirm $32=0" and a queue
     button.
  2. On Save, the profile is committed, `$30`/`$31` are written, then `writeGrblSetting(32,'0')` is
     refused.
  3. The toast reads "Software setup was saved, but firmware sync stopped: Laser machine setup cannot
     write $32=0…".
  - Harmless to the firmware, but the UI offers a write it cannot make.
- **Evidence:** REPRO.
  - Command (temporary, since deleted):
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/device-setup/zz-c4-diff.test.ts --silent=false`.
  - `computeFirmwareDiffs({...DEFAULT_DEVICE_PROFILE, laserModeEnabled:false}, rows{32:'1'}, {machineKinds:['laser']})`
    returned `$32` with `desired:"0"` and `writable:true`.
  - `grblSettingMachineKindIssue('laser',32,'0')` returned the refusal text.
- **Refuter:** CONFIRMED (REPRO + READ).
  - Same temporary test: `$32` gave `desired:"0"`, `differs:true` and `writable:true`. The machine
    kind rule returned the laser refusal.
  - `queuedFirmwareDiffs` filters only `differs && writable && queued`.
  - `onSave` commits the profile, then runs `syncFirmware` (`use-machine-setup-save.ts:63-89`).
    That goes through `writeGrblSetting` → `machineSettingsWriteBlockReason:46-47` and the same
    refusal.
  - The Laser mode checkbox (`DeviceProfilePowerFields.tsx:76-80`) is hosted by
    `DeviceSetupMachineStep`.
- **Fix direction:** Compute `writable` with `grblSettingMachineKindIssue` for the active machine
  kind, and show the refusal as review-only text.

### P3-4 — The settings table and backup label grblHAL's `$21`/`$22` bitfields as "0/1" with GRBL meanings

- **Where:**
  - `src/core/controllers/grbl/grbl-setting-definitions.ts:149,159` (`unit: '0/1'`, "Enables GRBL
    homing with $H.").
  - `src/ui/laser/machine-settings-presentation.ts:106-112` (no dialect).
  - The same metadata is written into every backup row (`grbl-settings.ts:62-71`).
- **Anchor:**
  - Ground truth: grblHAL `settings.c` L2377-2385. `$21` is an XBitfield "Enable,Strict mode[,Disable
    for rotary axes]". `$22` is an XBitfield of 11 homing options (L473).
  - Twin: `parse-settings.ts` `grblEnableBit` and `super-console-settings-diagnostics.ts:131-140`
    already treat `$22=5` as "homing enabled plus options".
  - Contract: WORKFLOW F-B14 step 5 ("value, unit, and KerfDesk-authored meaning").
- **Scenario:** A grblHAL board reports `$22=5`. Machine Settings shows `$22 | 5 | 0/1 | Homing
  cycle — Enables GRBL homing with $H.`, and the exported backup row carries the same unit. An
  operator copying "0/1" back would write `$22=1` and lose "Homing on startup required".
- **Evidence:** REPRO (same temporary diff test). `presentGrblSetting` returned
  `["$21","3","0/1","Hard limits",…]` and `["$22","5","0/1","Homing cycle","Enables GRBL homing with $H."]`.
- **Refuter:** CONFIRMED (REPRO + SOURCE).
  - Same temporary test, same output.
  - grblHAL `d7aaee3` `settings.c`: `$21` is an `XBitfield` (L2377/L2379) and `$22` an `XBitfield`
    over `homing_options` (L2385; L473 lists 11 entries).
  - Caveat: a build with `COMPATIBILITY_LEVEL > 1` uses `Format_Bool` (L2382, L2387), where "0/1"
    is correct. The default build uses the bitfields.
- **Fix direction:** Give the presentation the controller kind. For grblHAL, label `$21`/`$22` (and
  the per-axis `$4`/`$5`) as bitfields, and decode bit 0 as the existing diagnostics do.

### P3-5 — The store-level writer no longer enforces the common-only allowlist; the guard that does is tested but unused

- **Where:**
  - `src/ui/state/machine-settings-write-readiness.ts:43` blocks only `unknown`/`read-only` rows, so
    `writeGrblSetting(100,'80')` or `(22,'0')` passes with no typed confirmation.
  - `src/core/controllers/grbl/grbl-setting-write.ts:22-57`. `buildGrblSettingWrite` (common
    allowlist `{30,31,32}`, typed-command confirmation for machine-critical settings, fresh-backup
    gate) has no production caller. It is only exported from `grbl/index.ts:25` and exercised by
    `grbl-setting-write.test.ts`.
- **Anchor:**
  - Contract: ADR-092 (`DECISIONS.md` ~L3841): the sync "inherits that action's `COMMON_WRITE_IDS`
    allowlist ($30/$31/$32)". ADR-205: "Only GRBL/grblHAL common settings may use" this path.
  - L7: the tests prove a guard that production does not run.
- **Scenario:** Latent. Today the only callers pass `$30`/`$31`/`$32` (`use-machine-setup-save.ts:76`
  after the `writeRisk === 'common'` filter) or `$32=0` (`SendRouterModeButton.tsx:28`). A future
  caller, such as an MCP or phone action or a "restore backup" feature, could write `$100`/`$130`/`$22`
  through the "guarded" action with no allowlist or typed confirmation.
- **Evidence:** READ (grep: `buildGrblSettingWrite` appears only in `grbl-setting-write.ts`,
  `grbl/index.ts` and its test).
- **Refuter:** CONFIRMED (READ, two independent lines). Latent, so P3.
  - Grep: `buildGrblSettingWrite` has no caller outside `grbl-setting-write.ts`, `grbl/index.ts`
    and its test.
  - `machineSettingsWriteBlockReason` (`:19-47`) has no id allowlist.
  - `DECISIONS.md` L3844-3846 (ADR-092) still says the action "inherits" a `COMMON_WRITE_IDS`
    allowlist. No symbol by that name exists anywhere in `src`.
  - The only production callers today are `use-machine-setup-save.ts:76` (`$130`/`$131` are
    `machine-critical`, so `writable` drops them) and `SendRouterModeButton.tsx:28`.
- **Fix direction:** Enforce the common-only rule in `machineSettingsWriteBlockReason`, or route
  `writeGrblSetting` through `buildGrblSettingWrite`. Otherwise delete the dead builder and its
  tests, and amend ADR-092's text.

### P3-6 — Snapshot comparison prints float noise in deltas and treats numeric-looking strings as equal

- **Where:**
  - `src/ui/laser/super-console/SuperConsoleSnapshotCompare.tsx:367-371` (`String(delta)`).
  - `src/core/controllers/grbl/compare-settings-snapshots.ts:78-108` (any value `Number()` accepts
    is compared numerically).
- **Anchor:** Twin. The values come from `$$`, which prints at most 3 decimals for GRBL (`report.c`
  `N_DECIMAL_SETTINGVALUE`) and per-format decimals for grblHAL. The delta should not show more
  precision than either side. grblHAL string settings (`Format_String`) are text, not numbers.
- **Scenario:** `$100` 80.000 vs 80.100 shows `+0.09999999999999432 (+0.1%)`. `$110` 0.100 vs 0.300
  shows `+0.19999999999999998`. A grblHAL string setting `0001` vs `1` is reported "Equivalent".
  Display only; nothing risky is decided from the comparison.
- **Evidence:** REPRO (same temporary core test). `compareSettingsSnapshots` returned
  `["$100","different",0.09999999999999432,…]`, `["$110","different",0.19999999999999998,199.99999999999997]`
  and `["$74","equivalent",0,0]`.
- **Refuter:** CONFIRMED (REPRO).
  - Same temporary test: `$100` gave `different` with delta `0.09999999999999432`, `$110` gave
    `different` with delta `0.19999999999999998`, and `$74` `0001` vs `1` gave `equivalent`.
  - `formatDelta` (`SuperConsoleSnapshotCompare.tsx:367-371`) prints `String(delta)` as is.
- **Fix direction:** Round the delta to the larger of the two printed decimal counts. Compare
  numerically only when both raw values match a plain decimal pattern, and fall back to raw text
  otherwise.

### P3-7 — The settings backup and the comparison snapshot write grblHAL passwords in clear

- **Where:**
  - `src/ui/laser/export-grbl-settings-backup.ts:43-44` (`createGrblSettingsBackup(options.rows)`
    with every `rawValue`).
  - `src/ui/laser/super-console/SuperConsoleSnapshotCompare.tsx:320` (`settings: input.rows`).
- **Anchor:**
  - Ground truth: grblHAL `settings.c` `setting_get_value` returns a `Format_Password` value in
    clear unless `hal.stream.state.webui_connected`, so a USB `$$` prints `$75`, `$77`, `$330`,
    `$331` and `$533` in clear. These ids are confirmed in PR #1364.
  - Twin: the diagnostic bundle keeps only `numericValue` and lists "raw settings values" as omitted
    (`diagnostic-bundle.ts:128-131,188`). PR #1364 redacts the same ids in the support report.
- **Scenario:** On a grblHAL network build, the snapshot export puts the Wi-Fi and admin passwords
  into `…-controller-settings.lfsettings.json`. The panel invites the user to "export each machine …
  then load both files", so that file is meant to travel between machines and people.
- **Evidence:** SOURCE + READ.
- **Refuter:** CONFIRMED (SOURCE + READ). Related to rolling-v2 27-P2-3 (support report, PR #1364
  open), which does not touch these two sinks.
  - grblHAL `d7aaee3` `setting_get_value` returns a `Format_Password` value in clear unless
    `hal.stream.state.webui_connected`, in both the direct branch and the `…Fn` getter branch.
  - `settings.h` L131, L133, L199, L200 and L372 confirm `$75`, `$77`, `$330`, `$331` and `$533`.
  - `createGrblSettingsBackup` and `createControllerSettingsSnapshot` copy `rawValue` verbatim.
    Neither file has any redaction.
  - PR #1364 (OPEN) changes only `src/ui/support/*`, `src/ui/app/*`, `ErrorBoundary`, the abort
    shortcut files and ADR-546.
  - Severity stays P3. The operator saves the file themselves, and it needs a network build with
    passwords set. Sharing the snapshot puts it near the P2 line.
- **Fix direction:** Mask known password settings in the snapshot export, as PR #1364 does. For the
  backup, keep the value but say in the save flow that the file contains controller passwords.

### P3-8 — The settings backup records no machine, profile or firmware identity

- **Where:** `src/core/controllers/grbl/grbl-settings.ts:22-27,62-71` (`format`, `version`,
  `createdAt`, `settings` only), and `export-grbl-settings-backup.ts:56-58` (filename carries only
  the date).
- **Anchor:** Twin. The snapshot export in the same app records `profile` and
  `controllerKinds {profile, active, detected}` (`controller-settings-snapshot.ts:27-35`). ADR-205
  and ADR-375 make this backup the operator's attested pre-write safety copy.
- **Scenario:** A user with a grblHAL router and a GRBL laser exports both backups on the same day.
  Both default to `kerfdesk-grbl-settings-2026-10-22.lfgrbl-settings.json`, and neither file says
  which controller or firmware it came from. Restoring by hand (there is no in-app restore) can
  apply the router's `$100`/`$110`/`$130` to the laser.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ, two independent lines).
  - The `GrblSettingsBackup` type (`grbl-settings.ts:22-27`) and `createGrblSettingsBackup`
    (`:62-71`) carry only `format`, `version`, `createdAt` and `settings`.
  - `suggestedBackupName` (`export-grbl-settings-backup.ts:56-58`) uses only the date.
  - The sibling snapshot records `profile` and `controllerKinds`.
  - Export-only re-checked: nothing in `src` reads `laserforge.grbl-settings.backup` or
    `.lfgrbl-settings.json`. Its only consumer is `MachineSettingsPanel.tsx:52` (export).
    `WORKFLOW.md` F-B14 item 3 (L2744) says "No Load-from-backup button".
  - The only settings file loaded back is the `.lfsettings.json` snapshot, for display. So the harm
    is limited to a manual restore outside KerfDesk, as stated.
- **Fix direction:** Add the profile name and id, the active and detected controller kind, and the
  `$I` build string to the backup, and put the profile name in the suggested filename.

## KNOWN (re-observed, not raised)

| Item | Prior report | State on `99a2e64b7` |
|---|---|---|
| A leading `/` hides `$…=` from the Console classifier, and `isEepromWriteLine` misses `/$30=…` | rolling-v2 17-P3-2 | open (P3-1 is a different spelling of the same class) |
| `$$` rows with grblHAL passwords reach the support report | rolling-v2 27-P2-3 | PR #1364 open (P3-7 covers the other sinks) |
| The guarded writer accepts any `$30 > 0`, including a small whole number, and does not check `$30` against `$31` | rolling-v2 03-P2-4 / 03-P2-5 | #1349 merged (Job Review `power-range-empty`, ADR-567 Amd 1) |

## Refuted

None. The refuter confirmed all nine findings. P2-1's `$22=1.0` detail was corrected (read back as
`$22=0`, soft limits forced off), and its `.0` part was limited to grblHAL builds before 20261015.

## Verified clean

- **Units:** `$$` values are millimetres whatever `$13` says, on all three firmwares, and KerfDesk
  converts none of them.
  - GRBL: `report.c` prints stored mm.
  - grblHAL: `setting_get_value` uses `ftoa` of the stored value. Inch scaling exists only in
    `get_axis_value*` for reports.
  - FluidNC: the proxies print config mm.
  - `$13` itself only drives position, WCO and feed normalisation, and a `$13` write hides position
    until `$$` confirms it.
- **Write gating:**
  - Machine Settings writes need a connection and Idle. Alarm, any job including a tool-change hold,
    motion, fire, auto-focus, a pending write or an operation all block them. They also need a `$$`
    read in this connection and a known, non-read-only row.
  - Console `$N=` writes need confirmation and a fresh Idle, and are blocked during any active job,
    tool-change hold included (`console-command-readiness.ts:90-100`).
  - GRBL would accept setting writes in Alarm (`system.c:172`). KerfDesk is stricter.
- **Stock GRBL values:**
  - The Console check reads the value as GRBL's line reader does.
  - GRBL itself refuses trailing garbage (`system.c:270`) and negative values (`settings.c:192`), and
    `$0 < 3`.
  - KerfDesk refuses fractions and values over 255 on the uint8 and flag ids (`$22=0.5`, `$1=300`).
- **Machine Setup sync:**
  - The comparison encodes with the draft's controller kind. The step blocks unless it equals the
    active driver kind (`DeviceSetupFirmwareStep.tsx:45`).
  - The writer re-encodes the same string, so the displayed, sent and verified value is one string.
  - The readback tolerance equals half the printed last digit.
  - HAL integer `.0` inputs are sent as integers (2026-10-06 F-07 fix).
  - Unchecking the backup attestation clears the queue (`device-setup-flow.ts:245`). Cancel sends
    nothing.
- **Backup export:**
  - It sends no command and is disabled with no rows.
  - Rows are cleared on disconnect, reset, MPG takeover and a `$13` write, so "read in the current
    connection" holds.
- **Snapshot import (L5):**
  - Size is capped at 2 MB before and after reading. The format is exact. Unexpected keys,
    non-integer and duplicate ids, and non-string values are refused.
  - Values render as React text.
  - The comparison drives no write or decision (its only consumer is `SuperConsoleSnapshotCompare`).
- **`$$` parsing:**
  - Duplicate ids: the last one wins.
  - Unknown ids stay as `unknown` rows, which cannot be written from Machine Settings.
  - `$N=N/A` (grblHAL `print_setting`) is kept as raw text.
  - grblHAL `$21`/`$22` Enable bit: `grblEnableBit`.
  - FluidNC `$$` (`$13` first, then `$10`, `$20–$23`, `$30`, `$32`, `$100–$13x`) parses.
  - A collection that ends in `error:N` resets the collector.
- **EEPROM streaming (ADR-644):** `isEepromWriteLine` catches `$…=` except `$J=`, G10, G28.1 and
  G30.1 after comment stripping. The only gap is the known `/` case.
- **FluidNC and the Falcon:**
  - FluidNC numeric `$N=` writes, including the `$Report/Inches=` long name (mapped to `$13=`), are
    refused.
  - The Falcon contract allows only `$150–$152` as whole numbers.
  - FluidNC and Falcon Machine Setup is `external-config`, so it never writes.

## Not verified

- No hardware. The grblHAL behaviour is from source at `d7aaee3` (the commit the code pins) and a
  faithful port of `read_float` / `read_uint`, not from a live board. Newer grblHAL may add a
  trailing-character check.
- FluidNC `$S`, `$CD` YAML and WebUI settings are not parsed or written by KerfDesk, so they were
  audited only to confirm that no write path exists.
- grblHAL plugin formats (`Format_IPv4`, driver-specific settings) were read, not exercised.
- The UI reachability of P3-3 and P3-4 is from code reading and pure-function repros, not a browser
  run.
- The ADR-648 owned-reset settings carry-over (#1333, #1338) was excluded as known and not
  re-audited.

```json
[
  {"id":"C4-P2-1","severity":"P2","area":"ctl-settings-eeprom","file":"src/core/controllers/console-setting-writes.ts","line":38,"anchor":"Ground truth grblHAL d7aaee3 settings.c settings_store_setting (no trailing check) + nuts_bolts.c read_uint (.0 multiplies); Contract ADR-375 decision 9 'grblHAL refuses such values itself'; Twin encodeGrblSettingValue + settingWasVerified in the Machine Settings lane","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Console $N= on grblHAL is sent unchecked; grblHAL stores the numeric prefix ($100=26,67 -> 26, $110=5O00 -> 5) or, on builds before 20261015, multiplies .0 ($1=25.0 -> 250; $22=1.0 -> 10, read back as $22=0 with homing and soft limits off); ok + $$ re-read with no comparison, so the operator is never told. Refuter: confirmed at d7aaee3 and master (prefix) and d7aaee3 (.0)"},
  {"id":"C4-P3-1","severity":"P3","area":"ctl-settings-eeprom","file":"src/core/controllers/grbl/console-command.ts","line":62,"anchor":"Ground truth gnea/grbl system.c read_float setting number; Contract ADR-375 decision 9, ADR-180 Amd 6; Twin isStoredSettingWriteLine","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"$22.0=0.5 / $+22=0.5 / $32.0=1 are classified as plain G-code: no confirmation, no stock-GRBL storage check, no $32 machine-kind rule, no $$ re-read (sibling of 17-P3-2)"},
  {"id":"C4-P3-2","severity":"P3","area":"ctl-settings-eeprom","file":"src/core/controllers/grbl/response.ts","line":28,"anchor":"Ground truth grblHAL report.c report_setting prints empty string values; Contract WORKFLOW F-B14 'remain visible ... instead of being dropped'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Empty grblHAL string settings ($74=) are classified unknown and dropped from the table, backup and snapshot"},
  {"id":"C4-P3-3","severity":"P3","area":"ctl-settings-eeprom","file":"src/ui/laser/device-setup/device-setup-firmware-diff.ts","line":97,"anchor":"Twin grblSettingMachineKindIssue (ADR-180 Amd 6) vs firmware diff writable; ADR-205","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Machine Setup offers a queued $32=0 for a laser with laser mode off; after Save the writer refuses it and firmware sync stops"},
  {"id":"C4-P3-4","severity":"P3","area":"ctl-settings-eeprom","file":"src/core/controllers/grbl/grbl-setting-definitions.ts","line":159,"anchor":"Ground truth grblHAL settings.c $21/$22 XBitfield; Twin grblEnableBit and super-console diagnostics; Contract WORKFLOW F-B14 step 5","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Machine Settings table and backup label grblHAL $21/$22 bitfields as unit 0/1 with GRBL meanings ($22=5 shown as a 0/1 setting)"},
  {"id":"C4-P3-5","severity":"P3","area":"ctl-settings-eeprom","file":"src/ui/state/machine-settings-write-readiness.ts","line":43,"anchor":"Contract ADR-092 COMMON_WRITE_IDS allowlist, ADR-205 common-only path; L7 grbl-setting-write.test.ts tests an unused guard","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"writeGrblSetting accepts machine-critical ids with no allowlist or typed confirmation; buildGrblSettingWrite (allowlist, typed confirmation, backup gate) has no production caller (latent)"},
  {"id":"C4-P3-6","severity":"P3","area":"ctl-settings-eeprom","file":"src/ui/laser/super-console/SuperConsoleSnapshotCompare.tsx","line":369,"anchor":"Twin $$ printed precision (GRBL report.c N_DECIMAL_SETTINGVALUE, grblHAL format decimals); grblHAL Format_String is text","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Snapshot compare shows float noise deltas (+0.09999999999999432) and calls numeric-looking string settings equal (0001 vs 1)"},
  {"id":"C4-P3-7","severity":"P3","area":"ctl-settings-eeprom","file":"src/ui/laser/super-console/SuperConsoleSnapshotCompare.tsx","line":320,"anchor":"Ground truth grblHAL setting_get_value prints Format_Password in clear over serial; Twin diagnostic-bundle omits raw values, PR #1364 redacts support report","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Settings backup and the shareable comparison snapshot write grblHAL Wi-Fi/admin/MQTT passwords ($75,$77,$330,$331,$533) in clear (other sinks of 27-P2-3)"},
  {"id":"C4-P3-8","severity":"P3","area":"ctl-settings-eeprom","file":"src/core/controllers/grbl/grbl-settings.ts","line":62,"anchor":"Twin controller-settings-snapshot.ts records profile + controllerKinds; ADR-205/ADR-375 backup as attested pre-write copy","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Settings backup has no machine, profile or firmware identity and a date-only default filename, so two machines' backups cannot be told apart for a manual restore"}
]
```
