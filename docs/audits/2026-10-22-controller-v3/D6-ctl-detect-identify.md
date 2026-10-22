# Controller audit v3 — D6 Controller detection and identity (`ctl-detect-identify`)

- **When:** 2026-10-22 21:10   **Tree:** origin/main @ `7cd526213` (audit worktree HEAD `a709d1ca1`;
  `git diff 7cd526213 HEAD -- src` is empty). `origin/main` moved to `972aba76c` during the audit.
  None of the files a finding below cites changed there. #1382 adds a grblHAL-keyed
  `statusReportMask` capability and #1381 changes Marlin's classifier for `echo:Home XYZ First`.
  Neither changes how `Cap:` lines or banners are routed.
- **Scope:**
  - Detection: `src/core/controllers/detect-controller.ts`, `select-controller-driver.ts`,
    `controller-firmware-report.ts`, `controller-capabilities.ts`, `controller-driver.ts`, the line
    classifiers each driver uses (`grbl/response.ts`, `marlin/response.ts`, `smoothieware/response.ts`),
    `grbl/build-info.ts`.
  - Readiness: `src/core/preflight/controller-readiness.ts`, `controller-readiness-messages.ts`,
    `laser-module-readiness.ts`; their callers `src/ui/laser/start-job-readiness.ts`,
    `start-job-controller-policy.ts`, `src/ui/app/controller-readiness-advisories.ts`.
  - Connect handshake and identity state: `src/ui/state/laser-connect-action.ts`,
    `laser-connection-actions.ts`, `laser-controller-handshake.ts`, `laser-line-handler.ts`
    (`handleLine`, `handleWelcomeLine`), `laser-controller-build-info.ts`,
    `controller-firmware-report-action.ts`, `laser-module-probe.ts`, `laser-controller-qualification.ts`,
    `src/platform/web/serial-worker-core.ts` (`invalidatesRefill`).
  - Identity surfaces (twins): `src/ui/laser/controller-identity-warnings.ts`,
    `ConnectedMachineProfile.tsx`, `job-review/job-review-live-rows.ts`,
    `device-setup/{use-find-machine.ts,device-setup-auto-fill.ts,DeviceSetupConnectStep.tsx}`,
    `super-console/MachineProtocolInventory.tsx`, `src/ui/state/native-bed-frame.ts`,
    `src/core/devices/{controller-streaming-mode.ts,controller-profile-compatibility.ts}`.
  - Governing: ADR-094 §4 (detection is advisory), ADR-095, ADR-096, ADR-375 (identity warnings),
    ADR-397 (Smoothieware asks the board), ADR-400 §8 (identity), ADR-420 (Find my machine),
    ADR-456 (FluidNC acknowledged lines), ADR-648 (owned-reset snapshot), PROJECT.md
    non-negotiable 21 and AGENTS.md "Machine and output policy" (refusals only for factual failures).
- **Primary sources fetched this session** (downloaded to the session scratchpad and read by line):
  - gnea/grbl master (1.1h): `grbl/report.c:172`, `grbl/grbl.h:25-26`, `doc/markdown/interface.md`
    (§ "In v1.1, Grbl's interface protocol has been tweaked", welcome message).
  - gnea/grbl tag `v1.1f.20170801`: `grbl/report.c:172`, `grbl/grbl.h:25-26`, `grbl/spindle_control.c:191-202`.
  - grbl/grbl master (0.9j, `20160726`): `grbl/report.c:151` (banner), `:434-460` (status format).
  - grblHAL/core master `4ec1ae44`: `report.c:307-316` (banner by COMPATIBILITY_LEVEL),
    `report.c:911-1110` (`report_build_info`), `grbl.h:40-45`, `config.h:82-97`, `protocol.c:224-275`.
  - grblHAL wiki "For sender developers" (welcome message not guaranteed; `0x87`, `$I+`).
  - FluidNC main `6735500a` and tags v4.1.1, v4.0.3, v3.7.8: `SettingsDefinitions.cpp:107-108`
    (`Start/Message`), `Report.cpp:137-160` (`report_init_message`), `Report.cpp:362-395` (`$I`),
    `Protocol.cpp:680-700` (start message on every reset), `Logging.cpp:35-36`, `git-version.py:13,24,60`.
    The FluidNC wiki timed out (as in D4), so FluidNC facts come from source.
  - Marlin 2.1.2.8: `gcode/host/M115.cpp:40-50,60-105`, `Configuration_adv.h:3626`,
    `MarlinCore.cpp:1185,1285`.
  - Smoothieware edge: `GcodeDispatch.cpp:273`, `USBSerial.cpp:322-333`, `main.cpp:103`,
    `SimpleShell.cpp:205-300,1262-1290`.
  - LightBurn forum threads on the xTool D1 Pro console (no standard GRBL banner reported).
- **Lenses run:** L1, L2, L3, L4, L7 as separate passes (the brief's stress lenses). L6 was folded
  into L4 (read failures, owned-command cleanup). L5 skipped: the only inputs are the controller's
  own replies, which the drivers treat as firmware ground truth, and their size bounds were checked
  (`parseFirmwareReport` 256 lines / 32 KiB; build info 8 lines × 512 chars).
- **Counts:** 7 raised → refuter: confirmed 7, plausible 0, refuted 0 → P1 0 / P2 0 / P3 7 (P3-6 is a
  KNOWN residue of the 2026-07-27 rule-7 inventory, so 6 new) (+6 KNOWN). Severity changes: none.
  The refuter argued for P2 on P3-3 and P3-5 and found no wrong-command or overflow consequence.

## Headline

KerfDesk picks the driver from the machine profile and never from the banner (ADR-094 §4), and
the banner matchers name every default welcome line correctly. That held for stock GRBL 1.1h and
1.1f, grblHAL, FluidNC v3 and v4, Marlin and Smoothieware. A wrong profile across firmware
families fails closed in practice: KerfDesk's Frame lines are refused or never answered on the
foreign firmware, and Start needs a completed Frame. (Refuter: this holds between families outside
the GRBL family. Inside it, GRBL, grblHAL, FluidNC and Falcon profiles frame and Start on each
other's firmware by design, with no physical harm found; see Refuted.)

The weak point is how identity is decided:

- **The banner is the only evidence.** With no banner (a board that was already running, or native
  USB), the handshake's own `$I` reply still names the firmware. KerfDesk parses it and discards
  that answer:
  - a stock `[VER:1.1h.20190830:]` leaves "identity unconfirmed";
  - `[FIRMWARE:grblHAL]` on the default GRBL profile does too, so Find my machine never offers grblHAL.
- **Ambiguous banners are settled by the profile.** "Grbl 1.1f" belongs to stock GRBL 1.1f and to
  grblHAL builds at COMPATIBILITY_LEVEL ≥ 1. KerfDesk records it as whichever family the profile
  names, with no "unconfirmed" warning.
- **Versions are not checked.** GRBL 0.9 and FluidNC builds made without git tags are labelled
  stock GRBL 1.1.

Readiness never blocks Start or Frame, which is the frame-first contract. Its evidence is session-
and epoch-scoped, and it cannot pass on a previous controller's data.

## Firmware string → detected family

The **Detected** column is `detectControllerFromBanner` as each driver's classifier routes the line
(`welcome` or `unknown` lines are banner candidates, `laser-line-handler.ts:101-105,342-345`). Run
through the real code in the temporary `zz-d6-detect-truth.test.ts` (REPRO, below). "All" means the
same answer on all five live drivers.

| Firmware | Exact string | Detected | Expected | Source |
|---|---|---|---|---|
| GRBL 1.1h (gnea) | `Grbl 1.1h ['$' for help]` | `grbl-v1.1` (all) | stock GRBL | gnea `report.c:172`, `grbl.h:25` |
| GRBL 1.1f (gnea, `20170801`) | `Grbl 1.1f ['$' for help]` | `grbl-v1.1`; **`grblhal` on the grblHAL driver** | stock GRBL (ambiguous with the next-but-one row) | tag `v1.1f.20170801` `report.c:172` (**P3-3**) |
| GRBL 0.9j (grbl/grbl) | `Grbl 0.9j ['$' for help]` | `grbl-v1.1` (all) | GRBL 0.9: pre-v1.1 protocol | grbl/grbl `report.c:151,434-460`; interface.md (**P3-4**) |
| grblHAL, COMPATIBILITY_LEVEL 0 | `GrblHAL 1.1f ['$' or '$HELP' for help]` | `grblhal` (all) | grblHAL | grblHAL `report.c:311-312` |
| grblHAL, COMPATIBILITY_LEVEL ≥ 1 | `Grbl 1.1f ['$' for help]` | `grblhal` on grblHAL; `grbl-v1.1` elsewhere | grblHAL (ambiguous) | `report.c:313-314`, `grbl.h:40-43` (**P3-3**) |
| grblHAL, native USB / network | *(no banner)* | `null` ("unconfirmed") | grblHAL: `$I` prints `[FIRMWARE:grblHAL]` | grblHAL wiki; `report.c:921-923,1030` (**P3-2**) |
| FluidNC v4.1.1 default | `Grbl 4.1 [FluidNC v4.1.1 (esp32-wifi) '$' for help]` | `fluidnc` (all) | FluidNC | `SettingsDefinitions.cpp:108`, `Report.cpp:137-160`, `git-version.py:60` |
| FluidNC v3.7.8 default | `Grbl 3.7 [FluidNC v3.7.8 (wifi) '$' for help]` | `fluidnc` (all) | FluidNC | v3.7.8 `Report.cpp` |
| FluidNC v4 built without git tags | `Grbl 4.x [FluidNC v4.x.x (noGit) (esp32-wifi) '$' for help]` | **`grbl-v1.1`** (all) | FluidNC | `git-version.py:13,24,60` (v4.0.3, v4.1.1) (**P3-5**) |
| FluidNC, custom `$Start/Message` | operator text, e.g. `Welcome to my laser` | `null` | FluidNC | `SettingsDefinitions.cpp:107-108` (writable) (**P3-5**) |
| Grbl_ESP32 | `Grbl 1.3a ['$' for help]` | `grbl-v1.1` (all) | GRBL-1.1-protocol fork | not fetched (banner format only) |
| Marlin boot | `start`, then `Marlin 2.1.2.8` | `marlin` (all) | Marlin | `MarlinCore.cpp:1185,1285` |
| Marlin M115 | `FIRMWARE_NAME:Marlin 2.1.2.8 (…) SOURCE_CODE_URL:… PROTOCOL_VERSION:1.0 …` | `marlin` (all; a reset boundary unless owned, C6-P3-5) | Marlin identity reply | `M115.cpp:63` |
| Marlin M115 capability | `Cap:EEPROM:1` | `null` (and dropped, **P3-1**) | capability line | `M115.cpp:40-50` |
| Smoothieware USB attach | `Smoothie` (then `ok`) | `smoothieware` (all) | Smoothieware | `USBSerial.cpp:332` |
| Smoothieware boot | `Smoothie Running @120MHz` | `smoothieware` (all) | Smoothieware | `main.cpp:103` |
| Smoothieware M115 | `FIRMWARE_NAME:Smoothieware, FIRMWARE_URL:…, X-ARCS:1` | message on the Smoothieware driver; `smoothieware` (reset boundary) on the others | Smoothieware identity reply | `GcodeDispatch.cpp:273` |
| xTool D1 (vendor) | M-code chatter such as `M2002 …` (no GRBL banner per forum logs) | `null` | xTool firmware | LightBurn forum (not a primary vendor source) |
| Ortur LM3 (OLF 2xx) | `GrblHAL 1.1f …`, `[FIRMWARE:grblHAL]`, `[OLF:211]` | `grblhal` | grblHAL | C7 forum captures (KNOWN C7-P2-2) |

The other vendor GRBL forks (Atomstack, Sculpfun, Falcon, grbl-LPC, MKS DLC32) were not captured from
a primary source. Any of them that prints `Grbl 1.1x …` is labelled stock GRBL, as the rows above show.

## Findings

### P3-1 — Marlin's firmware report never records a `Cap:` line: the store drops every `unknown` line before the owned M115 can collect it

- **Where:**
  - `src/ui/state/laser-line-handler.ts:101-105`: every `unknown` line becomes a banner candidate,
    and `handleLine` returns after `handleWelcomeLine` even when detection finds nothing (`:359-360`).
    So the line never reaches `consumeControllerCommandResponse`
    (`laser-interactive-command.ts:203-235`), which is how an owned command collects its responses.
  - `src/core/controllers/marlin/response.ts:41-49`: `Cap:NAME:0|1` is none of Marlin's known shapes,
    so it is `unknown`.
  - `src/core/controllers/controller-firmware-report.ts:74-75,104-112`: `parseCapability` exists
    for these lines and is only ever fed by the unit test.
- **Anchor:**
  - Ground truth: Marlin 2.1.2.8 `M115.cpp:40-50,60-105` prints `FIRMWARE_NAME:…`, then one
    `Cap:<NAME>:<0|1>` line per capability. `EXTENDED_CAPABILITIES_REPORT` is on in the stock
    `Configuration_adv.h:3626`.
  - Twin: `controller-firmware-report.test.ts` asserts that `parseFirmwareReport('marlin', …)` reads
    `Cap:` lines, while the store path behind **Read firmware report** never delivers them.
- **Scenario:** Super Console → Machine protocol and firmware → **Read firmware report** on a Marlin
  laser. The report shows FIRMWARE_NAME, PROTOCOL_VERSION, MACHINE_TYPE and EXTRUDER_COUNT, and no
  "Firmware claims" line. The diagnostic bundle's `reportedCapabilities` is `[]` although the Console
  transcript shows the `Cap:` lines.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-d6-marlin-firmware-report.test.ts --silent=false`
    (real store, fake port answering `M114` and `M115` as Marlin 2.1.2.8).
  - Output: `D6-MARLIN-REPORT fields=["FIRMWARE_NAME","PROTOCOL_VERSION","MACHINE_TYPE","EXTRUDER_COUNT"] caps=[] transcriptHasCap=true epochStable=true`.
  - The same lines handed straight to `parseFirmwareReport` give
    `[{"name":"SERIAL_XON_XOFF","enabled":false},{"name":"EEPROM","enabled":true}]`.
- **Refuter:** CONFIRMED (code read plus the auditor's REPRO). P3 stands. New: no ledger, audit
  or open PR mentions the firmware report's `Cap:` lines.
  - Tried to refute it with an upstream consumer. `classifyMarlinResponse` (`marlin/response.ts:24-48`)
    gives `Cap:EEPROM:1` no shape, so it returns `unknown`. `bannerCandidateRaw`
    (`laser-line-handler.ts:342-345`) takes every `unknown` line. `handleWelcomeLine` returns at
    `:359-360` when detection is `null`, and `handleLine` returns after it (`:101-105`), so
    `consumeControllerCommandResponse` (`:123-124`) never sees the line.
    `consumeOwnedControllerIdentityResponse` (`laser-interactive-command.ts:295-303`) takes only
    `welcome` lines with `FIRMWARE_NAME:`.
  - Impact is display-only: the Super Console report and the diagnostic bundle. Nothing gates on
    `reportedCapabilities`.
- **Fix direction:** Let a banner candidate that detection rejects continue into
  `handleNonBannerLine` (or offer `unknown` lines to the owned command first). Add a store-level
  test for Marlin `Cap:` lines.

### P3-2 — With no banner, identity stays "unconfirmed" even though KerfDesk's own `$I` reply names the firmware: stock 1.1h proof and `[FIRMWARE:grblHAL]` are both discarded

- **Where:**
  - `src/ui/state/laser-controller-handshake.ts:284-316` (`refreshHandshakeBuildInfo`) stores the
    stock parse and the raw lines and logs "not recognized as stock GRBL build information". It
    never sets `detectedControllerKind`.
  - Only `handleWelcomeLine` sets `detectedControllerKind` (`laser-line-handler.ts:385-388`).
  - `src/ui/laser/controller-identity-warnings.ts:74-80` then gives the "unconfirmed" warning.
  - `src/ui/laser/device-setup/device-setup-auto-fill.ts:113-120` adopts only a detected family, so
    Find my machine never proposes grblHAL here.
  - `src/ui/state/native-bed-frame.ts:114-125` (`hasCurrentStockEvidence`) needs
    `detectedControllerKind === 'grbl-v1.1'`, so a proven stock 1.1h board without a banner gets no
    stock envelope.
- **Anchor:**
  - Ground truth: grblHAL's sender guide says "it is not always possible for the controller to send
    the welcome message on sender connection".
  - Ground truth: grblHAL `report.c:921-923` forces the extended `$I` at COMPATIBILITY_LEVEL 0, and
    `:1030` prints `[FIRMWARE:grblHAL]`. Stock `$I` is `[VER:1.1h.20190830:]` `[OPT:…]`
    (gnea `grbl.h:25-26`).
  - Contract: the design-audit rule 7 (2026-10-20) says "Identify the firmware explicitly; do not
    rely on a banner that native USB boards never print".
  - Extends KNOWN D-4: D-4's fix is scoped to the generic grblHAL driver, but here the default
    stock-GRBL driver already sends `$I` and throws the answer away.
- **Scenario:**
  1. A native-USB grblHAL board (no banner on open) is set up with Find my machine on the default
     GRBL v1.1 profile.
  2. The handshake's `$I` returns `[FIRMWARE:grblHAL]`. KerfDesk stays on the stock driver and
     every Job Review says "identity unconfirmed … verify the controller identity". The draft is
     never offered grblHAL.
  3. With the stock driver, grblHAL's latched line error is never cleared (ADR-400 HF-7, KNOWN
     consequence in C7-P2-2). After one refused line, the next G-code action (Frame tool-off,
     Set origin, Zero Z) fails with the stale code until a `$` line clears it.
  - A stock GRBL 1.1h board connected without a reset also stays "unconfirmed" after `$I` proves
    it is 1.1h.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-d6-lost-banner.test.ts --silent=false`
    (real store, fake port, no banner).
  - Stock 1.1h: `detected=null qual=qualified buildInfo={"protocolVersion":"1.1h","buildRevision":"20190830",…}`,
    with `identityWarnings=["Controller identity unconfirmed: no firmware family has been detected …"]`.
  - grblHAL COMPAT 0: `detected=null … raw=[…,"[FIRMWARE:grblHAL]",…]`, with the same "unconfirmed"
    warning.
- **Refuter:** CONFIRMED (code read plus primary source; the auditor's REPRO agrees). P3 stands.
  KNOWN-adjacent: this extends D-4. D-4's fix card ("On the generic grblHAL driver only, send `$I`")
  would not reach this stock-driver path.
  - Code: `refreshHandshakeBuildInfo` (`laser-controller-handshake.ts:284-316`) only stores the
    evidence and a log line. `detectedControllerKind` is written only by `handleWelcomeLine` (`:388`)
    and is cleared at connect.
  - Primary source (grblHAL core master, fetched): `report.c:921-923` forces `extended = true` at
    `COMPATIBILITY_LEVEL == 0`, so `[OPT:]` gets five fields and the reply runs past two lines.
    `parseBuildInfoResponses` requires exactly two lines (`build-info.ts:48`), so the reply is
    rejected.
  - Why not higher: the session is not silent. Every Job Review carries the "Controller identity
    unconfirmed" warning (`controller-identity-warnings.ts:74-80`). The latched-error effect in
    step 3 is HF-7/C7-P2-2. PR #1385 fixes it only for the Ortur LM3 presets, so it stays live for
    a default-profile native-USB grblHAL board. That is a KNOWN consequence, not this finding's.
- **Fix direction:** Feed the handshake's `$I` result into identity. A strict stock 1.1h/1.1g parse
  confirms `grbl-v1.1`. `[FIRMWARE:grblHAL]` (or a reply to `0x87`) identifies grblHAL and raises the
  mismatch warning and the Find adoption, as a banner would. A FluidNC `[VER:… FluidNC …]` identifies
  FluidNC. Fold this into D-4's fix.

### P3-3 — "Grbl 1.1f" is settled by the profile and recorded as identified; neither direction is disclosed, and grblHAL's compatibility `$I` passes as stock build proof

- **Where:**
  - `src/core/controllers/detect-controller.ts:35,48`. On the grblHAL driver, "Grbl 1.1f" returns
    `grblhal`; on every other driver it returns `grbl-v1.1` (`:17`). Both are stored as the detected
    family (`laser-line-handler.ts:385-388`).
  - `src/ui/laser/controller-identity-warnings.ts:61-81` therefore says nothing: no mismatch and no
    "unconfirmed".
  - `src/ui/laser/start-job-readiness.ts:345-352` passes `detected ?? active` to the
    power-range-empty text.
  - `src/core/controllers/grbl/build-info.ts:84,96` accepts any `1.1[a-z]` with any 8-digit build and
    a three-field `[OPT:]`.
- **Anchor:**
  - Ground truth:
    - Stock GRBL `v1.1f.20170801` prints exactly `Grbl 1.1f ['$' for help]` (`report.c:172`).
    - grblHAL at COMPATIBILITY_LEVEL ≥ 1 prints the same (`report.c:313-314`, `GRBL_VERSION "1.1f"`
      at every level, `grbl.h:40-43`).
    - At those levels grblHAL's plain `$I` is not extended (`report.c:921-923`): only
      `[VER:1.1f.<build>:]` and `[OPT:<codes>,<blocks>,<rx>]`.
    - The last stock 1.1f build is `20170801` (gnea tags `v1.1f.20170131` … `v1.1f.20170801`).
  - Contract: ADR-400 §8 says "`Grbl 1.1f` on the grblHAL driver identifies grblHAL". The code's
    own comment says the banner "fits stock GRBL 1.1f and such a grblHAL build alike".
  - Twin: C5 lists as verified clean that "grblHAL and FluidNC never send `$I`, so their variant
    output cannot pass as stock proof". On the stock driver it can.
- **Scenario:**
  - (a) A stock GRBL 1.1f laser (common on older diode machines) on a grblHAL profile, with
    `$30=$31`. Job Review shows no identity note. The power-range warning says "grblHAL then
    switches to on/off spindle control, so S no longer sets laser power". The firmware actually
    "fires full power even at S0" (`spindle_control.c:191-194` in 1.1f).
  - (b) A grblHAL COMPATIBILITY_LEVEL 1 board on the default GRBL profile. `$I` →
    `[VER:1.1f.20261015:]` `[OPT:VNMSL,35,1024]` is stored as stock build info. With detected
    `grbl-v1.1` this satisfies `hasCurrentStockEvidence` (`native-bed-frame.ts:114-125`), so the
    stock-GRBL jog envelope is applied. That is the case C3 left "Not verified" (far-edge inset 0
    where grblHAL pulls both edges in).
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-d6-detect-truth.test.ts --silent=false`.
  - Banner: `D6-1.1F detected=grblhal identity=[] noBanner=1`.
  - Power-range text: `resolved="… grblHAL then switches to on/off spindle control …"` against
    `stock="… The controller fires full power even at S0 … (stock GRBL)…"`.
  - Build info: `D6-BUILDINFO hal={"ok":true,"value":{"protocolVersion":"1.1f","buildRevision":"20261015",…,"rxBufferBytes":1024}}`.
- **Refuter:** CONFIRMED (independent REPRO plus primary source). P3 stands, and the P2 case was
  argued and rejected.
  - Source (grblHAL core master, fetched): `report.c:311-315` prints `Grbl 1.1f ['$' for help]`
    for `COMPATIBILITY_LEVEL != 0`. `grbl.h:40-45` has `GRBL_VERSION "1.1f"` at both levels and
    `GRBL_BUILD 20261015`. `report.c:921-923` and `:1004-1013` print a three-field `[OPT:…,<blocks>,<rx>]`
    when not extended. `config.h:82-97` says level 1 reports "itself as Grbl".
  - REPRO: `src/ui/laser/zz-d6r-refute.test.ts` (temporary, deleted).
    - `D6R-1.1F det=[grbl-v1.1=grbl-v1.1 grblhal=grblhal fluidnc=grbl-v1.1 …]`.
    - `halParse={"ok":true,…"rxBufferBytes":1024}`, `idGrbl=[] idHal=[]`.
    - Window with that build info and the stock 120-byte request:
      `{"bytes":120,"source":"build-info","provenBytes":1016}`.
  - Why not P2: a grblHAL board recorded as confirmed stock GRBL gives no wrong command. The
    driver comes from the profile, so "unconfirmed" would leave every command unchanged. Checked
    each lead:
    - `$`-setting validation follows `driver.kind` (`console-setting-writes.ts:38`,
      `grbl-setting-number.ts:50-52`), not the banner.
    - KerfDesk never writes `$10` (grep: no `$10=` writer in `src`).
    - The RX window is min(profile request, `$I` 1024 less reserve), which is right for grblHAL.
    - Realtime bytes are shared.
    - grblHAL at level ≥ 1 has no line-error latch (`protocol.c:266-272`), so the stock driver's
      missing re-arm is harmless there.
    - In direction (a), the grblHAL driver's empty-line re-arm is answered `ok` by stock GRBL too.
  - Correction to scenario (b): the jog envelope (`manual-motion-limits.ts:94-100`
    `travelFirmware`) follows the active profile and would be stock GRBL with or without
    detection. Only the native bed mapping (`native-bed-frame.ts:114-125`, display and advisories,
    "never gates Start") depends on the detected family. C3's far-edge inset question belongs to
    the profile, not to identity.
  - Note for fix cards: C4-P2-1 (Console `$N=` on grblHAL) and C8-P2-2 (`statusReportMask`) both
    key on `driver.kind`, so neither reaches a compatibility-level grblHAL board behind a GRBL
    profile. For example, `$22=1.0` passes the stock check and a pre-20261015 grblHAL stores 10.
    That chain needs a non-default build, a GRBL profile and a typed `.0`, so it adds no severity
    here.
- **Fix direction:**
  - Treat "Grbl 1.1f" as consistent with both families: unconfirmed, and use the `unknown` firmware
    wording until `$I` settles it. On a grblHAL profile send `$I+` (extended at every level, D-4),
    which prints `[FIRMWARE:grblHAL]`.
  - On the stock driver, a `1.1f` build dated after `20170801` is not stock GRBL.

### P3-4 — GRBL 0.9 is labelled GRBL v1.1; its status reports are never parsed, and qualification fails with "Waiting for a fresh controller status … when the connection responds and reports Idle" while it answers Idle on every poll

- **Where:**
  - `src/core/controllers/detect-controller.ts:17` (`/^Grbl [\d.]+/i` → `grbl-v1.1` for any version).
  - `grbl/response.ts:90-94`: the pipe-grammar status parser rejects `<Idle,MPos:…,WPos:…>`, so the
    line is `unknown`.
  - `laser-controller-qualification.ts:305` holds the message.
  - `detect-controller.test.ts:46` asserts `'Grbl 0.9j'` → `grbl-v1.1`, restating the code.
- **Anchor:**
  - Ground truth: gnea `interface.md` says "In v1.1, Grbl's interface protocol has been tweaked".
    The status report, settings and messages changed.
  - Ground truth: grbl/grbl 0.9j `report.c:151` prints `Grbl 0.9j ['$' for help]`, and `:434-460`
    reports `<Idle,MPos:…,WPos:…>`.
  - Twin: detection names a family whose driver cannot speak this version.
- **Scenario:** An old 3018 CNC or diode laser still on GRBL 0.9j connects with the default profile.
  KerfDesk records "GRBL v1.1" as detected (no mismatch). Every `?` is answered, and the transcript
  fills with `<Idle,MPos:…>` lines. Qualification ends "failed: Waiting for a fresh controller
  status … when the connection responds and reports Idle", and nothing says the firmware predates
  v1.1. It fails closed: no status means no Frame and no Start.
- **Evidence:** REPRO.
  - Command: `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-d6-grbl09-connect.test.ts --silent=false`
    (real store, fake port, 30 s of fake time).
  - Output: `D6-GRBL09 detected=grbl-v1.1 active=grbl-v1.1 qual={"kind":"failed","epoch":2,"message":"Waiting for a fresh controller status. …"} status=undefined`,
    with the log ending in six `<Idle,MPos:0.000,…,WPos:…>` lines.
- **Refuter:** CONFIRMED (code read plus the auditor's REPRO). P3 stands. New: no ledger mentions
  pre-1.1 GRBL.
  - Code: `matchStatus` → `parseStatusReport` splits on `|` (`status-parser.ts:167-171`), so a
    comma-format report is rejected and the line becomes `unknown`.
  - `detect-controller.test.ts:47` pins `Grbl 0.9j` → `grbl-v1.1`.
  - Borderline P2 under "misleading result", but kept at P3. ADR-006 scopes KerfDesk to "GRBL
    v1.1+ only". The failure is closed on every connect (no status, no Frame, no Start), so only
    the text misleads. It also breaks ADR-006's "refuses … with clear error" spirit for an
    unsupported version. The `grbl-compatible` dialect that ADR-257's consequences offer
    "firmware older than 1.1f" (`DECISIONS.md:13096`) cannot help 0.9/1.0, which never qualify.
- **Fix direction:** Detect only `Grbl 1.1x` (and the known forks) as `grbl-v1.1`. Report "GRBL 0.9
  is not supported (pre-v1.1 protocol)" for an older version, and have the qualification text say so
  when status lines arrive in the old format.

### P3-5 — FluidNC identity rests on a configurable start message: a build without git tags reads as stock GRBL, and Find my machine then swaps the operator's FluidNC choice for GRBL with buffered streaming

- **Where:**
  - `src/core/controllers/detect-controller.ts:15,17`: `/^Grbl [\d.]+ \[FluidNC/` needs digits up to
    the space, so "Grbl 4.x [FluidNC …" falls through to `/^Grbl [\d.]+/` → `grbl-v1.1`.
  - `device-setup-auto-fill.ts:113-120` adopts the detected family, and `use-find-machine.ts:196-215`
    then reconnects with it.
  - `controller-profile-compatibility.ts:192-207` (`requiredStreamingModeFor`) restores
    `char-counted` when the family changes from FluidNC to GRBL.
- **Anchor:**
  - Ground truth: FluidNC `git-version.py` (v4.0.3 and v4.1.1, `:13,24`) sets `tag = "v4.x.x"` when
    git or a tag is unavailable. That covers a source download or a shallow clone without tags.
    `:60` gives `grbl_version = "4.x"`, and the default `Start/Message` `Grbl \V [FluidNC \B (\X) \H]`
    (`SettingsDefinitions.cpp:108`) becomes `Grbl 4.x [FluidNC v4.x.x (noGit) …`.
  - Ground truth: `Start/Message` is a writable setting, and FluidNC prints it, and only it, after
    every reset (`Protocol.cpp:699-700`). A custom message gives no detection at all.
  - Contract: ADR-456 says FluidNC must stream acknowledged lines.
- **Scenario:**
  1. An operator who built FluidNC v4 from a source zip chooses FluidNC in Machine Setup and presses
     Find.
  2. The banner reads as stock GRBL. Auto-fill changes the draft to GRBL v1.1 with `char-counted`
     streaming and reconnects with the GRBL driver.
  3. On a profile kept as FluidNC, Job Review advises "If this machine runs GRBL v1.1, choose GRBL
     v1.1".
  - The physical effect of buffered streaming on FluidNC is not reproduced; ADR-456 is source-based.
- **Evidence:** REPRO (`zz-d6-detect-truth.test.ts`).
  - `D6-NOGIT detected=grbl-v1.1 advice=["Controller identity mismatch: … the firmware banner identifies GRBL v1.1. … choose GRBL v1.1 …"]`.
  - `D6-NOGIT-SETUP draftBefore=fluidnc/ping-pong adopted=grbl-v1.1 draftAfter=grbl-v1.1/char-counted`.
  - A custom message gives `bare=null` on every driver.
- **Refuter:** CONFIRMED (independent REPRO plus primary source). P3 stands, and the P2 case
  (stream corruption or overflow) was argued and rejected.
  - Source (FluidNC, fetched):
    - `git-version.py` at v4.1.1 (`:12-13`, `:23-24`, `:60`) and v4.0.3 (`:13`, `:24`, `:62`)
      sets `tag = "v4.x.x"`, so `grbl_version` is `4.x`.
    - `SettingsDefinitions.cpp:108` (v4.1.1) is the writable `Start/Message` default.
    - Every published tag (v3.2.6 … v4.1.1) still yields a `[\d.]+` version, so only tagless v4
      builds and custom messages miss.
  - REPRO (`zz-d6r-refute.test.ts`, deleted):
    - `D6R-NOGIT det=[grbl-v1.1=grbl-v1.1 grblhal=grbl-v1.1 fluidnc=grbl-v1.1 marlin=grbl-v1.1 smoothieware=grbl-v1.1]`.
    - FluidNC's `$I` (`[VER:4.x FluidNC …]`, `[OPT:PHSE]`, plus `[CLUSTER:]` and a `Machine:` msg,
      `Report.cpp:363-398`) fails the stock parser: `fluidI.ok=false`.
    - With a 1024-byte request on the GRBL driver: `bytes:120,source:"stock-fallback"` with no
      evidence, and `bytes:120,source:"controller-reported"` with a `Bf:` of 128.
  - Why it cannot overflow:
    - FluidNC's `Bf:` second field is `UART_FIFO_LEN (128) − buffered`
      (`esp32/fnc_uart.cpp:185-190`), and `$10` defaults to 1, so `Bf` is off
      (`SettingsDefinitions.cpp:101`). The GRBL driver therefore keeps at most 120 bytes in flight.
    - FluidNC installs a 256-byte UART ring (`fnc_uart.cpp:52,73`; v4.0.3 `:47-49`).
    - While a line awaits its `ok`, `pollLine` keeps reading and queues the other bytes
      (v4.1.1 `Channel.cpp:375-425`) up to `_queue_limit = 4 * 255` (`Channel.h:82`). v4.0.3's
      queue is unbounded (`Channel.cpp:207,233`).
    - FluidNC accepts `$J=` jog (`ProcessSettings.cpp:612,1144`).
    - Result: the swap breaks ADR-456's documented channel contract only nominally. No line can be
      dropped at 120 bytes. The harm is the wrong identity, wrong advice, a GRBL settings panel on
      a YAML firmware (writes are readback-verified) and slower Home timing. All P3.
- **Fix direction:**
  - Match `Grbl \S+ \[FluidNC` and take FluidNC's own `[VER:… FluidNC …]` from `$I`/`$I+` as the
    identity.
  - Do not let auto-fill replace an operator-chosen acknowledged-line family with a buffered one on
    banner evidence alone.

### P3-6 — Readiness comments say CNC "remains strict" and that an absent-setting `'error'` "blocks Start", but no caller gates on `ok`: Start demotes every readiness error to a Job Review warning

- **Where:**
  - `src/core/preflight/controller-readiness.ts:89-96` ("CNC remains strict because unknown $30/$32
    changes spindle and plunge semantics") and `:143-147` ("'error' blocks Start").
  - The behaviour: `src/ui/laser/start-job-controller-policy.ts:20-38` maps `controller.errors` to
    advisories, and `laser-controller-qualification.ts:88-92` says qualification no longer gates
    Start.
  - `grep` finds no caller reading `runControllerReadiness(...).ok`.
- **Anchor:**
  - Twin: comment against code.
  - Contract: PROJECT.md non-negotiable 21 and AGENTS.md make Job Review warnings the rule, which
    matches the code. The comments are what is wrong.
- **Scenario:** A maintainer reading the readiness module believes a CNC Start with unread `$32` is
  refused. It is not: it is a warning. This bears on fixes like D4-P2-1, where a "strict" CNC gate
  would be assumed to exist.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, KNOWN residue. P3 stands.
  - Two lines of evidence: `start-job-controller-policy.ts:34` maps every `controller.errors`
    entry to an advisory, and there are only two `runControllerReadiness` callers
    (`start-job-readiness.ts:345`, `controller-readiness-advisories.ts:40`). Neither reads `.ok`.
    The only other consumer of the CNC messages, `JobReviewWarnings.tsx:111`, only expands text.
  - Not new: `git blame` puts both comments (`controller-readiness.ts:90-93`, `:143-146`) in
    `f13110e39` (#284, 2026-07-17). The 2026-07-27 rule-7 inventory
    (`docs/audits/2026-07-27-rule7-preflight-refusal-inventory.md:47-58,246`) recorded that
    commit's `controller-readiness.ts` comments as "stale documentation". A later rewording fixed
    the comments at `:107-112` and `:119-124` and missed these two. Ledger as a KNOWN leftover.
- **Fix direction:** Reword both comments to "returned as an error, which Start shows as a Job
  Review warning and Save as an advisory".

### P3-7 — The connection card names only the driver Connect bound; the banner's family appears in Job Review, Machine Setup and the Console, never next to the connected machine

- **Where:**
  - `src/ui/laser/ConnectedMachineProfile.tsx:16-18,32` shows `selectControllerDriver(active).label`
    and never reads `detectedControllerKind`.
  - Its twins:
    - `job-review/job-review-live-rows.ts:341-349` ("grbl-v1.1 (banner says fluidnc)", in raw
      kind ids);
    - `device-setup/DeviceSetupConnectStep.tsx:186-215` ("the controller's banner reports …");
    - the Console notice from `laser-line-handler.ts:378-385`.
- **Anchor:** Twin. The brief's Q5 asks that the connection toolbar, the machine profile panel and
  Job Review show one identity. ADR-094 §4 requires only the logged warning.
- **Scenario:** A FluidNC board on a GRBL profile. The connection card says "… · GRBL v1.1" for the
  whole session. The disagreement shows only in the Console (scrolled away) and at Job Review time.
  Job Review spells it with internal ids rather than the labels the warnings use.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (two reads). P3 stands. New: no audit or open PR names the connection
  card.
  - `ConnectedMachineProfile.tsx:9-36` reads `activeControllerKind`/`activeControllerCommandSet`
    only.
  - The mismatch line reaches only `log`/`transcript` (`laser-system-notice.ts:14-30`); it is not
    a toast.
  - Job Review's row prints raw ids (`job-review-live-rows.ts:341-349`).
- **Fix direction:** Show "banner: <label>" (or "identity unconfirmed") on the connection card when
  the detected family differs from or is missing for the active driver. Use driver labels in Job
  Review's firmware row.

## KNOWN (re-observed, not re-raised)

- **D-4 / P-4 (2026-10-20 controller design audit).** The generic grblHAL driver sends no `$I` and
  no `0x87` (`grblhal/driver.ts:84`). Still open. P3-2 is the stock-driver path that D-4's fix, as
  scoped, would not cover.
- **C6-P3-5.** A Marlin `FIRMWARE_NAME` reply is a `welcome`, so an M115 not typed exactly `M115`
  crosses the reset boundary. The table row agrees.
- **C7-P2-2 (fix PR #1385).** The Ortur LM3 runs grblHAL, and the latched-error consequence on the
  stock driver is cited in P3-2.
- **C3 "Not verified".** grblHAL in compatibility mode behind a stock profile is modelled as stock.
  P3-3(b) supplies the `$I` evidence C3 lacked.
- **C8-P2-2 (PR #1382, merged after the audited tree).** grblHAL `$10` turns WCO/Ov off. Its new
  `statusReportMask: 'grblhal-fields'` is keyed on the driver, so it follows the same identity
  question as P3-3. Not audited.
- **Rolling-v2 17.** A power-glitch banner inside the 500 ms owned-reset window is taken as the
  owned reset (ADR-648 retention).

## Refuted

The refuter refuted none of the seven findings. Candidates the auditor raised and dropped, with
the refuter's stress-test note where one applies:

- **grblHAL at COMPATIBILITY_LEVEL ≥ 1 on the grblHAL driver strands an owed `ok` with the
  empty-line re-arm.** Dropped. An empty line answers `ok` at every level (`protocol.c:247-249`
  `Status_OK`). Only the latch itself is level-0-only (`:266-271`).
- **The firmware report or build info outlives the session it was read in.** Dropped.
  `MachineProtocolInventory.tsx:22-26` and `diagnostic-bundle.ts:158-165` show the report only when
  its `sessionEpoch` is current. Build info is cleared at connect, at every banner
  (`emptyControllerBuildInfoState`) and at port close.
- **A wrong cross-family profile can Start.** Dropped. Start needs a completed Frame, and Frame's
  lines fail on the foreign firmware:
  - GRBL `$J=` and `M5`/`M9` on Smoothieware get `error:Invalid statement`, or a jog with an unknown
    axis word (`SimpleShell.cpp:243-262,1262-1290`).
  - Marlin `M5 I` on GRBL is an error.
  - GRBL `?` on Marlin is buffered with no newline and answers nothing, so no status, and no Frame.
  - **Refuter (stress test):** this holds only between firmware families outside the GRBL family.
    - Re-checked on Smoothieware edge (fetched). `SimpleShell::jog` (`:1263-1320`) drops the first
      token (`$J=G90`) and then refuses `G21` with `error:bad axis G`. Smoothieware's own Frame
      tool-off (`fire off`, `M400`, `M221 S0`, `M120`) is refused by GRBL.
    - Inside the GRBL family the claim does not hold. The GRBL and FluidNC drivers frame with
      `$J=G90 G21 X… Y… F…`, which FluidNC (`doJog`, `ProcessSettings.cpp:612,1144`) and grblHAL
      accept. The Falcon command set frames with `G21 G90` and `G1 … S0` (REPRO `D6R-FRAME`),
      which stock GRBL accepts.
    - So a GRBL↔grblHAL↔FluidNC↔Falcon profile mix-up completes Frame, and Start proceeds on the
      wrong driver. That is by design: `framed-run.ts:124-126` says "identity disagreement is
      disclosed in Job Review, not refused".
    - No physical harm was found on any such pair:
      - the GRBL driver on FluidNC keeps 120 bytes or less in flight (P3-5);
      - the stock driver on grblHAL level 0 latches errors and fails closed (KNOWN HF-7/C7-P2-2);
      - a Falcon or grblHAL driver's `$HX`/`$HZ` on stock GRBL leaves it in the Homing state with
        no motion, which fails closed (CG-9 mechanism).
    - Disclosure is missing for "Grbl 1.1f" on a grblHAL profile (P3-3).
- **`controller-readiness-advisories.ts:40` (Save) omits `firmwareKind`.** Dropped. It gets the
  `unknown` text, which is accurate for both families.
- **A FluidNC v3 build without git tags is mis-detected.** Dropped. The v3.7.8 `git-version.py`
  defaults to `v3.0.x`, so the banner is `Grbl 3.0 [FluidNC …`, which matches. Only v4 uses `4.x`.
- **Smoothieware laser-module evidence goes stale across a UART reboot.** Not raised. The re-probe
  after the banner runs on the first fresh Idle. A board without the module answers `M221` with
  only `ok`, which is the success path that sets `absent`. Only a failed re-probe keeps the old
  evidence (`laser-module-probe.ts:67-101`). See Not verified.

## Verified clean

- **Banner matching** for every default welcome line in the table: stock GRBL 1.1h/1.1f, grblHAL
  COMPATIBILITY_LEVEL 0, FluidNC v3.7.8 and v4.1.1, Marlin `start` and `Marlin <ver>`, Smoothieware
  attach and boot. Order matters: FluidNC is tested before the generic `Grbl`. Matching is
  case-insensitive where the firmware varies (`grblHAL`/`GrblHAL`). Lines are trimmed. The banners
  are each preceded by an EOL in firmware (`report.c` `\r\n…`, grblHAL `ASCII_EOL`, FluidNC's empty
  spacer line), so boot noise cannot glue onto them.
- **No false banners from ordinary traffic.** None of the non-banner lines sampled matched:
  `Cap:` lines, xTool `M2002 …`, GRBL 0.9 status lines, `[MSG:…]` and `[VER:…]` brackets, and
  ESP32 boot text. The serial worker's refill guard (`serial-worker-core.ts:260-272`) uses the same
  matcher and reaches the same yes/no.
- **The driver is never switched by a banner** (ADR-094 §4). The driver comes from the profile at
  Connect (`laser-connect-action.ts:72,140`). A mismatch reaches the Console
  (`laser-line-handler.ts:378-385`), Job Review (`controller-identity-warnings.ts:41-82`) and
  Machine Setup (`DeviceSetupConnectStep.tsx:186-215`). Only Machine Setup's Find adopts a detected
  family, into the draft, with Undo (ADR-420).
- **Session-scoped identity and evidence.** At Connect (`laser-connection-actions.ts:230-272` plus
  `connectionScopedEvidenceReset`), at port close (`laser-store-helpers.ts:418-440`) and at every
  banner (`laser-line-handler.ts:386-428`), KerfDesk resets all of these: `detectedControllerKind`,
  `controllerSettings`, build info, `rxCapacityEvidence`, `plannerCapacityEvidence`, the CNC live
  caps, `ovCache` and `accessoryCache`. Laser-module evidence and the frame-push count reset at
  Connect. The one retention is ADR-648's owned-reset snapshot, bound to the reset KerfDesk sent on
  the same port.
  - **Refuter (stress test): holds as stated, with one qualification.**
    - A native-USB board cannot be swapped without the port closing. Unplugging ends the USB CDC
      device, and a port whose read side ends is closed (ADR-400 §7). KerfDesk's own resets also
      bump the epoch without a banner (`invalidateControllerSessionEvidence`,
      `laser-controller-evidence.ts:5-22`).
    - The gap is a firmware reboot whose banner KerfDesk does not recognise, on a port that stays
      open (a USB-UART bridge powered from USB while the controller power-cycles). Examples are a
      FluidNC custom `Start/Message`, vendor banners, and ESP32 ROM text. `handleWelcomeLine`
      returns at `detected === null`, and grep finds no other reboot detector in `src`. So
      settings (including the `$30` power scale, `connected-laser-power-scale.ts:19-30`), build
      info, `homingState: 'confirmed'` and the detected kind survive the reboot.
    - That gap is bounded:
      - the Frame permit expires on the position or WCO jump (`framed-run.ts`,
        `FRAME_START_POSITION_CHANGED_MESSAGE`);
      - a mid-stream reboot strands the in-flight window's acknowledgements, so the stream stalls
        into the watchdog;
      - the lost-reply reconcile acts only once the whole program is on the wire
        (`laser-lost-ack-reconcile.ts:12-14`);
      - a same-board reboot keeps the same EEPROM `$30`.
    - KNOWN lead: 2026-09-25 controller audit `tracks/HF.md:655` ("Unrecognised reboot banners …
      are not treated as a reset boundary"). No new P2.
- **Readiness never refuses Start or Frame.** Every `runControllerReadiness` error becomes a Job
  Review advisory (`start-job-controller-policy.ts:20-38`). `laserFireRefusal` refuses only Fire,
  whose `fire` line nothing would answer (a transport fact, `laser-module-readiness.ts:36-38`). The
  absent-module job warning and the stripped `fire off` match ADR-397.
- **FluidNC readiness wording.** `readonly-dump` maps to `fluidnc-yaml`
  (`controller-readiness-messages.ts:17-21`), consistent with FluidNC `$30`/`$32` being read-only
  proxies.
- **Hosted (worker) streaming is offered only to GRBL-family drivers**
  (`laser-connect-action.ts:294-307`).
- **Firmware report bounds and ownership.** At most 256 lines and 32 KiB, 32 fields and 64
  capabilities. A conflicting field throws. The report is owned by connection, driver, session and
  operation (`controller-firmware-report-action.ts:36-46`), and the operation is cleared in
  `finally`.

## Not verified

- **No hardware.** No vendor banner (xTool, Atomstack, Sculpfun, Creality Falcon, grbl-LPC, MKS
  DLC32, Grbl_ESP32) was captured from a primary source. The xTool D1 row rests on LightBurn forum
  logs only.
- **FluidNC with a custom `Start/Message`.** FluidNC prints only that message after a Ctrl-X
  (`Protocol.cpp:699-700`), so KerfDesk would see no reset boundary. What that does to owed replies,
  owned-reset cleanup and homing state was not reproduced.
- **Buffered streaming to FluidNC** (P3-5's end state). ADR-456 is source-based. No overflow was
  reproduced. Refuter: settled from source instead. The GRBL driver's window on FluidNC is 120
  bytes or less, against a 256-byte UART ring and a line queue of up to 1020 bytes (v4.1.1), so no
  overflow is possible (see P3-5).
- **Smoothieware over UART:** a failed `M221` re-probe after a reboot keeps the previous boot's
  evidence and the module-less driver. `connectedLaserModuleEvidence` does not compare its
  `sessionEpoch` (`laser-module-probe.ts:59-65`). Not exercised.
- **`origin/main` `972aba76c`.** #1382 (`statusReportMask`) and #1381 (Marlin home-first) were not
  audited.
- **Grbl_ESP32 (`Grbl 1.3a`) on the stock driver** beyond its banner: `$I` fails the stock 1.1x
  parser, which is conservative. Its `$$` and jog were not checked.

```json
[
  {"id":"D6-P3-1","severity":"P3","area":"ctl-detect-identify","file":"src/ui/state/laser-line-handler.ts","line":101,"anchor":"Ground truth: Marlin 2.1.2.8 M115.cpp:40-50 Cap: lines, Configuration_adv.h:3626 EXTENDED_CAPABILITIES_REPORT on; Twin: controller-firmware-report.test.ts vs store","evidence":"REPRO","verdict":"CONFIRMED","known":null,"summary":"Every unknown line is a banner candidate and handleLine returns before the owned M115 can collect it, so Marlin's Read firmware report never records a Cap: line (caps=[] though the transcript has them)"},
  {"id":"D6-P3-2","severity":"P3","area":"ctl-detect-identify","file":"src/ui/state/laser-controller-handshake.ts","line":284,"anchor":"Ground truth: grblHAL sender guide (banner not guaranteed), grblHAL report.c:921-923,1030 [FIRMWARE:grblHAL]; Contract: 2026-10-20 design audit rule 7","evidence":"REPRO","verdict":"CONFIRMED","known":"extends D-4 (2026-10-20 design audit)","summary":"With no banner, identity stays 'unconfirmed' although the handshake's own $I proves stock 1.1h or prints [FIRMWARE:grblHAL]; Find never offers grblHAL for native-USB grblHAL on the default GRBL profile"},
  {"id":"D6-P3-3","severity":"P3","area":"ctl-detect-identify","file":"src/core/controllers/detect-controller.ts","line":48,"anchor":"Ground truth: gnea v1.1f.20170801 report.c:172 and grblHAL report.c:313-314 print the same banner; grblHAL report.c:921-923 non-extended $I; Contract: ADR-400 s8","evidence":"REPRO","verdict":"CONFIRMED","known":null,"refuter":"P2 argued and rejected: driver follows the profile; $-validation keys on driver.kind, no $10 writer, RX window bounded by $I 1024, realtime bytes shared, no latch at level >= 1. Jog envelope follows the profile, not detection","summary":"'Grbl 1.1f' is resolved from the profile and recorded as identified (no unconfirmed note, grblHAL power-range text for a stock 1.1f), and grblHAL's compatibility $I passes the stock build-info parser"},
  {"id":"D6-P3-4","severity":"P3","area":"ctl-detect-identify","file":"src/core/controllers/detect-controller.ts","line":17,"anchor":"Ground truth: gnea interface.md (v1.1 protocol tweaked), grbl/grbl 0.9j report.c:151,434-460","evidence":"REPRO","verdict":"CONFIRMED","known":null,"summary":"GRBL 0.9j is labelled GRBL v1.1; its status reports are never parsed and qualification fails 'when the connection responds and reports Idle' while it answers Idle every poll"},
  {"id":"D6-P3-5","severity":"P3","area":"ctl-detect-identify","file":"src/core/controllers/detect-controller.ts","line":15,"anchor":"Ground truth: FluidNC git-version.py:13,24,60 (v4 noGit 'Grbl 4.x'), SettingsDefinitions.cpp:107-108 writable Start/Message, Protocol.cpp:699-700; Contract: ADR-456","evidence":"REPRO","verdict":"CONFIRMED","known":null,"refuter":"P2 argued and rejected: GRBL driver keeps <=120 B in flight on FluidNC (stock-fallback or Bf=UART_FIFO_LEN 128); FluidNC has a 256 B UART ring and a 1020 B pending-ack line queue (v4.1.1 Channel.cpp:375-425), so no overflow or dropped line","summary":"A FluidNC v4 build without git tags reads as stock GRBL; Find adopts GRBL over the operator's FluidNC and restores char-counted streaming; a custom Start/Message gives no identity"},
  {"id":"D6-P3-6","severity":"P3","area":"ctl-detect-identify","file":"src/core/preflight/controller-readiness.ts","line":143,"anchor":"Twin: comments vs start-job-controller-policy.ts:20-38 (errors become advisories); PROJECT.md NN21","evidence":"READ","verdict":"CONFIRMED","known":"2026-07-27 rule-7 inventory recorded the f13110e39 (#284) controller-readiness.ts comments as stale documentation; these two survived the later rewording","summary":"Readiness comments say CNC 'remains strict' and an absent-setting 'error' blocks Start; nothing gates on ok and Start shows every error as a Job Review warning"},
  {"id":"D6-P3-7","severity":"P3","area":"ctl-detect-identify","file":"src/ui/laser/ConnectedMachineProfile.tsx","line":32,"anchor":"Twin: job-review-live-rows.ts:341-349, DeviceSetupConnectStep.tsx:186-215, Console notice laser-line-handler.ts:378-385","evidence":"READ","verdict":"CONFIRMED","known":null,"summary":"The connection card names only the bound driver; the banner's family (or its absence) shows in the Console, Machine Setup and Job Review (in raw ids) but never beside the connected machine"}
]
```
