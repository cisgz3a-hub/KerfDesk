# Rolling audit v4 — Machine setup and connect

- **When:** 2026-10-27   **Tree:** origin/main @ `a59f74ff9` (the worktree's `src/` is identical).
  `origin/main` has since moved to `105d6374c` (#1460–#1464 merged). Where a later merge touches a
  finding's file, the finding says so; none of the three findings is fixed there.
- **Scope:** the H4 journey and every way the app learns or changes a machine fact:
  - first run and the last-machine restore (`startup-project.ts`, `last-machine-persistence.ts`,
    `use-machine-profile-persistence.ts`, `MachineSetupBanner.tsx`);
  - the Machine Setup wizard and picker (`src/ui/laser/device-setup/**`, ADR-637 + Amd 1–2,
    ADR-420), including its profile import (`MachineSetupImportExport.tsx`,
    `src/io/lightburn/lbdev-*.ts`, `src/io/machine-profile/**`);
  - Machine panel edits through `updateDeviceProfile` (`store-actions.ts`, safety zones, rotary,
    module, saved positions);
  - Console `$` writes, `writeGrblSetting`, Machine Setup's firmware sync;
  - the connect handshake and settings reads (`laser-controller-handshake.ts`,
    `detected-settings-action.ts`, `parse-settings.ts`), and the settings kept across an owned reset
    (`laser-owned-reset-settings.ts`, ADR-648);
  - the remote connect and Home (`remote-control/machine-actions.ts`), for parity only (H8 owns it);
  - opening a project for the same or another machine (`project-actions.ts`,
    `project-bed-reconciliation.ts`, ADR-500 Amd 1, ADR-440 Amd 3, ADR-400 Amd 1);
  - the dependents: native bed frame, manual-motion limits, job placement, the job machine lock
    (ADR-416 Amd 2), report units, frame evidence, CNC live caps.
- **Lenses run:** L9 (main), L1, L3, L4, L6, L2 for the GRBL handshake. L5 only for profile import
  (C7 and 13-P1-1 already covered it). L7 is folded into the fix directions.
- **Counts:** 3 raised → 0 refuted → P1 1 / P2 1 / P3 1 (refuter: 3 CONFIRMED, no severity change)
  (+7 KNOWN re-encountered; 3 more folded into findings as KNOWN in part).

## Headline

The controller side of this journey holds: every settings read is stamped to its session, a `$`
write retires the snapshot it changes, and the job machine lock guards every store write. The gaps
are on the project side, where the machine profile can be replaced wholesale:

- **H4-P1-1.** Opening a project saved earlier for the *same* machine (same profile id, name and bed)
  silently puts back that file's copy of the machine. In the repro, an origin corrected from
  front-left to rear-left and a clamp no-go zone added since are both undone with no notice. The
  same artwork then burns at Y380 instead of Y20, and the clamp warning disappears. The next
  unrelated machine edit then saves the file's copy as the app's machine for the next session.
  #1437 and #1352 already protect only the camera calibration and the Auto-focus command from this.
- **H4-P2-1.** **Import KerfDesk profile** / **Import LightBurn .lbdev** on the Machine stage
  replaces the draft's no-go zones, camera calibration, scan-offset table, rotary setup and saved
  positions without the "Replace settings?" question that a list choice on the same stage asks
  (ADR-637 Amd 1 #2).
- **H4-P3-1.** A vendor LightBurn device file imports as stock GRBL with no command set, so the
  Falcon A1 Pro's own file loses Creality's commands. Nothing warns while the board's banner reads
  `Grbl …` (the refuter found that a grblHAL banner does get a Job Review warning).

The refuter confirmed all three with its own repros and changed no severity. The no-go half of
H4-P1-1 was deferred by D5, not decided.

## L9 — where machine facts are learned or changed

| Entry point | Writes | Dependents updated | Guards | Result |
|---|---|---|---|---|
| Wizard Save (`replaceMachineSetup`, `machine-setup-actions.ts:62-138`) | Project device, machine, workspace, placement, cached CNC | Workspace, placement (`jobPlacementAfterProfileSelection`), CNC scene, probe setup, mode switch, Undo, last machine | UI job lock (`use-machine-setup-save.ts:44-49`) + store job lock | Clean |
| Wizard list choice (`apply-preset`) | Draft | — | Names replaced tuned values first (`DeviceSetupMachinePicker.tsx:143-150`) | Clean |
| Wizard profile import (`DeviceSetupIdentifyStep.tsx:31`) | Draft, via the same `apply-preset` | — | **None** | **H4-P2-1**, **H4-P3-1** |
| Auto-fill / Use detected values | Draft | — | A listed machine keeps its work area (ADR-637 Amd 2) | Clean (Use detected values copies the area by design, Amd 2 #5) |
| Firmware sync (`$30/$31/$32`) | Controller | Re-read `$$`, verified | Typed confirm, Idle, this-session `$$` | Clean (E2, C4) |
| Machine panel (`updateDeviceProfile`, `store-actions.ts:88-99`) | Project device | Workspace, placement, scan table and Z confirmation reset (`device-profile-patch.ts:8-39`), Undo | Store job lock | Clean |
| First-run banner (`replaceDeviceProfile`) | Project device | Workspace, placement, cached CNC, Undo | Store job lock; shown only on the untouched starter | Clean |
| Console `$N=` / Machine Settings write | Controller | Snapshot retired, re-read; homing, WCO and Frame proof reset when the setting moves coordinates (`grbl-settings-evidence.ts:15-51`) | Confirm, value check | Clean on the tree for `$`; FluidNC `[k]v` and Smoothieware `G20` are KNOWN G4-P1-1/2 |
| Connect handshake | Laser store settings, build info, `$G` | Native bed frame, limits, power scale, CNC live caps; all epoch-stamped | — | Clean; handshake checked below |
| Owned reset (ADR-648) | Re-stamped snapshot | Same | Kept only if no `$` write went out since the read (`laser-owned-reset-settings.ts:96-102,157-166`), counted at `laser-safe-write.ts:122` and `laser-job-actions.ts:157` | Clean |
| Open a project (`project-actions.ts:86-110`) | Whole project device | Notice only when profile id, name or bed differ; camera and Auto-focus kept for the same machine | Store job lock | **H4-P1-1** |
| Phone / MCP | Connect (remembered port only), Home, origin | Same store actions | Remote gates | Home with profile homing off: KNOWN H8-P3-1 |

## Findings

### H4-P1-1 — Opening an older file for the same machine silently reverts the machine's origin, homing, no-go zones and other settings, and the next machine edit saves them as the app's machine

- **Where:**
  - `src/ui/state/project-actions.ts:86-110`: `setProject` installs the file's whole `project.device`.
    Only the camera fields (`withCurrentMachineCamera`, `:93`) and the Auto-focus command
    (`withCurrentMachineAutofocus`, `:92`) are kept from the machine in use.
  - `src/ui/state/project-bed-reconciliation.ts:27,134-136`: the notice fires only when
    `profileId|name|bedWidth|bedHeight` differ. A changed origin, homing, zone list, scan-offset table,
    rotary setup, saved positions, frame speed or controller is not compared.
  - `src/ui/app/use-machine-profile-persistence.ts:14-31`: the Open itself is skipped (`:17`), but the
    very next device or mode change saves `state.project.device` (the file's whole copy) as
    `kerfdesk.last-machine.v1`.
  - Unchanged on origin/main `105d6374c`: #1463 adds `bedSizeOnly` and camera fields to the notice,
    still only when `machineChanged`.
- **Anchor:**
  - **Contract:** ADR-500 Amendment 1, Decision 2: Open uses the document's machine "without silently
    replacing the independently saved application machine preference". The repro shows that
    preference replaced by the next unrelated edit.
  - **Twin / contract reasoning:** ADR-440 Amendment 3 (Context) names this exact loss for the camera:
    "The next machine edit then saves the file's profile ... as the app's machine". ADR-400
    Amendment 1 item 3 gives the reason it applies to any machine fact: "a file can copy the identity
    that hides the notice. So the operator's own setting decides for their own machine." Only those
    two fields got the protection.
  - **Contract:** PROJECT.md Safety non-negotiables 1 (bounds) and 2 (origin honesty). A no-go zone is
    a configured guard (ADR-232).
- **Scenario:**
  1. The operator saves `sign.lf2` while the profile says origin front-left, with no zones.
  2. They then find the machine is rear-left and correct the origin in Machine Setup. They also add a
     clamp zone (0,0)–(60,60). Same machine name, profile id and bed.
  3. They reopen `sign.lf2`. No banner, no toast.
  4. The origin is front-left again and the zone list is empty. A line drawn at canvas (20,20) is now
     emitted at `G1 X20 Y380` instead of `G1 X20 Y20`, 360 mm from where the canvas shows it on the
     real rear-left machine. The no-go collision warning (2 issues before) is gone.
  5. The operator changes the frame speed, or switches Laser/CNC. The front-left, zone-less copy
     becomes the remembered machine, so the next session starts with it too.

  The same applies to a scan-offset table calibrated after the file was saved: bidirectional rows
  lose their compensation. It also applies to homing turned on since, rotary setup, saved positions
  and a corrected controller family. Frame traces the reverted placement but compares it with
  nothing, so under METHOD §3 (2026-10-27) it is not a warning.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/app/zz-h4-open-older-file.test.tsx` (deleted). A copy is at
    `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\h4-repros\open-older-file.test.tsx`.
    It uses the real store, the real `useMachineProfilePersistence` hook mounted, and
    `serializeProject`/`deserializeProject` + `setProject`. Output comes from `emitGcode`.
  - **Command:** `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-h4-open-older-file.test.tsx --silent=false --reporter=verbose`
    → 1 passed.
  - **Output:**
    - `machine-now {"origin":"rear-left","zones":1,"burn":["G1 X20.000 Y20.000 F1500 S500"],"noGoIssues":2}`
    - `lastMachine-before-open {"origin":"rear-left","zones":1}`
    - `open {"result":"loaded","notice":null,"toasts":[]}`
    - `after-open {"origin":"front-left","zones":0,"burn":["G1 X20.000 Y380.000 F1500 S500"],"noGoIssues":0}`
    - `lastMachine-after-edit {"origin":"front-left","zones":0}`
- **Novelty:** **KNOWN in part.**
  - D5 (controller v3) listed the no-go-zone half under KNOWN as "a maintainer decision, not raised".
  - Rolling-v2 12-P2-1 raised the camera half. #1437 fixed it (ADR-440 Amd 3), and meta v1 M6-P3-1
    recorded that the product treats the behaviour as a bug.
  - Controller v3 D8-P3-4 (open, P3) covers a shared file's verified scan-offset table on the same
    mechanism (refuter addition).
  - New here:
    - the origin, homing and scan-offset effects, with a reproduced position error;
    - the ADR-500 Amd 1 #2 break, where the next edit saves the file's copy as the app's machine.
- **Severity:** P1 (proposed): wrong physical position, reachable today, no warning.
  - A refuter weighing ADR-500 Amd 1 #2 ("Open uses that document's machine") should note that the
    same clause forbids the persistence half.
  - The maintainer has already reversed the "document's machine" reading twice: camera in ADR-440
    Amd 3, Auto-focus in ADR-400 Amd 1.
- **Refuter:** CONFIRMED (REPRO + twin). Severity stays **P1**.
  - **What would make it false:** an ADR that wants the file's machine to win silently, a notice
    or warning before output, or output that is not physically wrong.
  - **Own repro** (temporary `src/ui/app/zz-h4r-open-same-machine.test.tsx`, deleted). It used
    different values from the auditor's: a 300 × 200 machine `shop-1` / "Shop laser", front-left
    corrected to rear-right, a "Clamp" zone, and a 10 mm line at canvas (20..30, 20). It opened
    through the real `completeNativeProjectOpen` with the persistence hook mounted:
    - `now {"origin":"rear-right","zones":1,"moves":["G0 X270.000 Y20.000 S0","G1 X280.000 Y20.000 F1500 S400",…],"noGo":2,"reviewOriginFact":{"label":"Machine origin","value":"rear right","tone":"default"}}`
    - `open {"opened":true,"banner":null,"toasts":["Opened sign.lf2"],"storeToasts":[]}`
    - `after-open {"origin":"front-left","zones":0,"moves":["G0 X20.000 Y180.000 S0","G1 X30.000 Y180.000 F1500 S400",…],"noGo":0,"reviewOriginFact":{…"value":"front left","tone":"default"}}`
    - `last-after-edit {"origin":"front-left","zones":0,"frame":2222}` (a frame speed edit)
    - The burn moves about 260 mm in X and 160 mm in Y on the real rear-right machine.
  - **Second, independent line: the job lock's twin.** The same `setProject`, run while a job is
    active, refuses this exact file. The output was `during-job {"result":"job-machine-locked"}`,
    with the app's own message "it uses a different Laser/CNC mode or machine setup. Nothing was
    opened." `JOB_MACHINE_DEVICE_KEYS` (`job-machine-lock.ts:35-50`) counts origin, homing,
    no-go zones, frame speed and rotary as the machine. ADR-416 Amendment 2 Decision 2 lists
    "origin, homing, … rotary, no-go zones" as part of "the job's machine". Outside a job, the
    Open notice compares only `profileId|name|bed` (`project-bed-reconciliation.ts:134-136`), so
    the same difference opens with no word.
  - **ADRs read:**
    - ADR-500 Amendment 1 Decision 2 does intend Open to use "that document's machine and
      settings", so on that text alone the defect would be only the missing notice.
    - ADR-440 Amendment 3 and ADR-400 Amendment 1 item 3 reverse it, for two fields only. Meta v1
      M6-P3-1 and G6 already rejected a "by design under ADR-500 Amd 1 §2" lowering for the
      camera half of this mechanism.
  - **Weak anchors.** Two of the cited anchors do not hold as written.
    - The "ADR-500 Amd 1 #2 break" in the persistence half is contested.
      `use-machine-profile-persistence.test.tsx:124-163` pins an explicit machine edit after Open
      as a commit of the opened machine (`profile: { name: 'File CNC' }`). The harm is that the
      edit commits a revert the operator never saw, the loss ADR-440 Amd 3's Context describes.
    - PROJECT.md non-negotiable 2 ("output coordinates match the device profile's origin") is
      not literally broken, because the output matches the profile in use. The twins above carry
      the finding.
  - **No warning reaches the operator.**
    - There is no machine notice (`banner: null`), and the only toast is the success toast
      "Opened …".
    - Job Review's "Machine origin" row is a `default`-tone fact that compares nothing, like Frame
      under METHOD §3 (2026-10-27).
    - `native-bed-frame.ts` never checks the origin against the controller ("never guesses or
      reverses an axis from homing direction", `core/devices/native-bed-frame.ts:12-14`).
    - `MachineSetupBanner` shows only on the generic starter.
    - Origin is not an identity field in the wizard: no setup path changes `profileId` or `name`
      on an edit, so the scenario is reachable from Machine Setup as well as the Machine panel.
  - **The D5 no-go half was never decided.** D5 wrote "This is a maintainer decision, not raised",
    which defers the question. No ADR, controller-v3 LEDGER row or later audit records a decision.
    The half stays folded here as KNOWN in part and is not split out. On its own it is a lost
    advisory, not a position error; the P1 rests on the origin half.
  - **Scan-offset half:** overlaps D8-P3-4 (open, P3: a shared `.lf2` keeps its "verified" table).
  - **Newer main:** unchanged on origin/main `105d6374c`. No open PRs.
  - **Severity (§3):** reachable today, a silent position error, and no specific warning before
    output. P1.
- **Fix direction:**
  - For a file whose machine has the same identity, keep the current machine's whole device profile,
    not just camera and Auto-focus. Say so with one toast when the file's copy differed. Bring the
    file's copy only behind the machine notice, as for another machine.
  - At minimum, raise the notice when any machine field differs, and stop the persistence hook from
    adopting a device that arrived by Open until the operator accepts it.
  - Add the open-then-edit case for the origin and zones to `camera-calibration-open.test.tsx`'s
    pattern.

### H4-P2-1 — Profile import on the Machine stage replaces the draft's no-go zones, camera calibration and other tuned values without the "Replace settings?" question a list choice asks

- **Where:**
  - `src/ui/laser/device-setup/DeviceSetupIdentifyStep.tsx:29-32`: **Import KerfDesk profile** and
    **Import LightBurn .lbdev** apply through `onApply={(profile) => dispatch({ kind: 'apply-preset', profile })}`.
    This is the reducer action a list choice uses (`device-setup-flow.ts` `applyPreset`, which sets
    `draft: profile` verbatim).
  - `src/ui/laser/MachineSetupImportExport.tsx:92-96,121-160`: the review cards list only what the
    file brings. **Apply imported profile** applies at once.
  - Twin: `src/ui/laser/device-setup/DeviceSetupMachinePicker.tsx:143-150` runs
    `machineChoiceReplaces` (`machine-choice-replaces.ts:25-57`) before a list choice and holds it
    behind **Replace settings** / **Keep current settings**.
  - `src/io/lightburn/lbdev-import.ts:96-123`: a LightBurn import is built from
    `DEFAULT_DEVICE_PROFILE` with `noGoZones: []` and `scanningOffsets: []`. A `.lfmachine.json`
    brings whatever the file holds.
  - The only later trace is Review's summary row "No-go zones 0 enabled"
    (`DeviceSetupReviewSections.tsx:161`). Save then stores it (`use-machine-setup-save.ts:56-85`),
    and the persistence hook remembers it.
- **Anchor:**
  - **Contract:** ADR-637 Amendment 1 item 2, "A choice asks before it replaces values someone set".
    It names the no-go zones, scan-offset, camera or rotary calibration and saved positions. The
    import sits on the same Machine stage (`DeviceSetupIdentifyStep.tsx:1-2`: "one list ... and
    machine-file import/export").
  - **Twin:** the list choice's ask, against the import's direct `apply-preset`.
  - **Contract:** ADR-440 Amd 3 (the calibration belongs to the machine); ADR-232 (zones reach
    review).
- **Scenario:**
  1. An Ortur LM3 owner has a clamp zone and a camera calibration.
  2. Wanting the vendor's S range and origin, they open Machine Setup and import Ortur's LightBurn
     `.lbdev`.
  3. The review card lists Name, Controller, Bed, Origin, Max S and Baud. They press **Apply imported
     profile**, then Next, Next, **Save**.
  4. The zone and the camera calibration are gone. The next job crossing the clamp gets no Job Review
     warning, and the camera overlay is uncalibrated.
  5. Choosing a machine from the list one row above would first have said "replaces the no-go zones
     and camera calibration set for the machine in this draft".

  Undo after Save restores it only if the operator notices. Cancel or Escape before Save discards the
  whole draft.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/laser/device-setup/zz-h4-import-replaces.test.tsx` (deleted). A copy
    is at `...\scratchpad\h4-repros\import-replaces.test.tsx`.
    - It renders the real `DeviceSetupIdentifyStep` (picker + import panel) on a `useReducer` harness.
    - The platform's open picker returns a JSON `.lbdev`.
    - The draft is the Ortur LM3 preset with one zone and a saved camera model.
  - **Command:** `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/device-setup/zz-h4-import-replaces.test.tsx --silent=false --reporter=verbose`
    → 1 passed.
  - **Output:**
    - `start {"zones":1,"camera":true,"prompt":null}`
    - `list-choice {"zones":1,"camera":true,"prompt":"Replace this machine’s settings? Choosing Genmitsu 3018-PRO replaces the no-go zones and camera calibration set for the machine in this draft. ..."}`
    - `review-card "Imported device review Ortur LM3 (vendor file) Applied Name: ... Controller: GRBL Bed width: 400 mm Bed height: 380 mm Origin: MirrorX off, MirrorY off Max S: 1000 Baud rate: 115200 Apply imported profile"`
    - `after-import {"name":"Ortur LM3 (vendor file)","zones":0,"camera":false,"prompt":null}`
- **Novelty:** new.
  - C7-P3-4 (open) is about an imported profile's claimed identity and out-of-range values.
  - The 2026-07-17 LightBurn importer audit covered parsing and size limits.
  - E2 and ADR-637 Amd 1 covered list choices only.
- **Severity:** P2 (proposed). A configured guard is removed by a setup choice with no word about
  it, against a clear contract. It is not P1: the operator applied an import deliberately, and the
  output follows the profile they saved.
- **Refuter:** CONFIRMED (REPRO + code). Severity stays **P2**.
  - **What would make it false:**
    - the import being outside ADR-637 Amd 1's scope with no other anchor;
    - the review card or Review naming what is lost;
    - an ADR that makes the import a deliberate whole-profile replacement.
  - **Own repro, on the other import path** (temporary
    `src/ui/laser/device-setup/zz-h4r-import-kerfdesk.test.tsx`, deleted).
    - **Setup:** the real `DeviceSetupIdentifyStep` on a `useReducer` harness. The draft is the
      Sculpfun S30 preset with a "Rail clamp" zone, a two-row verified scan table and a saved
      position. **Import KerfDesk profile** reads the operator's own `.lfmachine.json` backup of
      the untuned S30.
    - **Output:**
      - `guard-if-asked ["no-go zones","scan-offset calibration","saved positions"]`
        (`machineChoiceReplaces` run on the import's own `apply-preset` action);
      - `start {"zones":1,"scanRows":2,"saved":1,"prompt":null}`;
      - `card "KerfDesk profile reviewSculpfun S30 (5 W, stock automatic air)Apply imported profile"`;
      - `after-apply {"zones":0,"scanRows":0,"saved":0,"prompt":null,"alerts":[]}`.
    - The KerfDesk card shows only the profile name.
  - **Scope.** ADR-637 Amd 1 item 2 is worded around the list: "Rows are one native radio group…",
    a CNC preset, **My machine isn't listed**. The import is outside its literal scope. The finding
    still stands on two other grounds:
    - **L9 twin.** The import sits on the same stage, dispatches the same `apply-preset`, changes
      the same draft fields, and the existing guard names them when asked.
    - **ADR-440 Amendment 3 Consequences.** The calibration "goes only when the operator
      recalibrates, chooses another machine, or clears the app's data". A backup of the same
      machine is none of these.
  - **Design history.** No ADR makes the import a deliberate wholesale replacement. ADR-240
    (DECISIONS.md) says only that a catalog card applies "verbatim through `apply-preset`", and
    ADR-637 Amd 1 later put a question in front of that.
  - **Review stage.** It shows only a count, "No-go zones 0 enabled"
    (`DeviceSetupReviewSections.tsx:161`), with no comparison against the saved machine.
  - **Other callers.** `ImportExportPanel` has no other caller (grep).
  - **Novelty.** Nothing in `docs/audits/` covers it. No open PRs, and unchanged on `105d6374c`.
  - **Severity (§3 P2):** an ordinary user hits it, the review card misleads, and a configured
    guard and calibrations are lost. Not P1: the operator chose to load a profile, and the output
    follows the saved profile.
- **Fix direction:** Route **Apply imported profile** through `machineChoiceReplaces` and the same
  Replace/Keep notice. Alternatively, keep the machine-owned fields (zones, camera models, scan table,
  rotary, saved positions) unless the file carries its own and the operator chooses it. Add the
  import case to `DeviceSetupMachinePicker.customised.test.tsx`.

### H4-P3-1 — A vendor LightBurn device file imports as stock GRBL with no command set, so Creality's Falcon A1 Pro file loses the Falcon commands with no warning

- **Where:**
  - `src/io/lightburn/lbdev-json.ts:64`: `isGrbl` is true for any driver name containing "grbl"
    (GRBL, GRBL-LPC, GRBL-M3).
  - `src/io/lightburn/lbdev-import.ts:96-123`: the profile keeps `DEFAULT_DEVICE_PROFILE`'s controller
    (stock GRBL v1.1) and sets no `controllerCommandSet`. The review says only "Mapped as
    GRBL-compatible" (`:140-148`).
  - Twins:
    - the catalog Falcon A1 Pro preset is `grblhal` + `creality-falcon-a1-pro`
      (`falcon-profiles.ts:7`);
    - `controller-identity-warnings.ts:130-144` warns a *preset copy* that lacks its command set,
      with the consequence text at `:27-32`. An imported file has a `lightburn-…` id, so it gets no
      warning.
  - `lbdev-json.ts:6` says the import is meant for "Creality's Falcon A1 Pro bundle" keys.
    `native-bed-frame.ts:119-121` records that the vendor file labels the controller GRBL-LPC.
- **Anchor:**
  - **Twin:** preset vs imported vendor file for the same machine; the stale-preset warning vs none.
  - **Contract:** ADR-322 §4 (the command set is bound from the profile at Connect, as cited in
    `controller-identity-warnings.ts:85-87`). Not re-quoted from `docs/decisions`, so this is a code
    citation.
- **Scenario:** A Falcon A1 Pro owner imports the `.lbdev` from Creality's LightBurn bundle
  (`Name: "GRBL-LPC"`). KerfDesk connects with the generic GRBL commands: Home `$H` instead of `$HX`
  then `$HY`, `$J=` jogs, a `$$` read, and, by KerfDesk's own consequence text, `M9` just before
  Start. A "Grbl 1.1" banner matches the imported kind, so Job Review shows no identity warning.
  For an Ortur LM3 file the same import silently undoes #1385 (C7-P2-2: the LM3 runs grblHAL).
- **Evidence:** REPRO.
  - **Test:** a temporary `src/io/lightburn/zz-h4-lbdev-falcon.test.ts` (deleted). A copy is at
    `...\scratchpad\h4-repros\lbdev-falcon.test.ts`.
  - **Output:**
    - `preset creality-falcon-a1-pro-grblhal {"kind":"grblhal","commandSet":"creality-falcon-a1-pro"}`
    - `import GRBL-LPC {"canCreate":true,"commandSet":null,"home":"$H","settingsQuery":"$$","applied":[..."Controller=GRBL-LPC (Mapped as GRBL-compatible.)"...],"needsReview":[],"identityWarnings":0}`
    - `GRBL` and `GRBL-M3` give the same result.
- **Novelty:** new. Earlier audits (2026-09-19, 09-21, 09-25 HF/CG, C7) discuss the GRBL-LPC label
  only for the catalog preset.
  - **Refuter correction:** KNOWN in part. The 2026-07-10 consolidated audit A.4.12 [POLISH]
    (`docs/audits/2026-07-10-consolidated-audit-v2.md:728-734`, still open in the 2026-07-11 fix
    verification) already says "The imported profile also never sets controllerKind, so even a GRBL
    import can't carry grblHAL identity." New here: the Falcon command set, and the stale-preset
    warning that an import never gets.
- **Severity:** P3 (proposed). The consequences named are a jog or Home error and air timing, not a
  position or power error that was shown. Not reproduced on a Falcon.
- **Refuter:** CONFIRMED for the mapping (REPRO). Severity stays **P3**. One scenario sentence is
  refuted.
  - **Own repro** (temporary `src/io/lightburn/zz-h4r-lbdev-driver.test.ts`, deleted):
    - `GRBL-LPC`, `GRBL-M3`, `grblHAL` and `GrblHAL` driver names all import with
      `{"kind":null,"set":null,"needsReview":[]}`, so the controller is left unset and connects as
      stock GRBL.
    - `liveControllerIdentityWarnings` gives 0 warnings with a `Grbl` banner.
    - It gives one "Controller identity mismatch … the firmware banner identifies grblHAL" warning
      with a grblHAL banner.
  - **Refuted part, the Ortur LM3.** "For an Ortur LM3 file the same import silently undoes #1385"
    is not silent. ADR-660 records the LM3's startup report as `GrblHAL 1.1f`, so Job Review shows
    the identity-mismatch warning and its advice to choose grblHAL in Machine Setup.
  - **The Falcon half depends on its banner.** The banner is unrecorded (`native-bed-frame.ts:119-121`).
    - With a `Grbl …` banner, nothing warns.
    - With a grblHAL banner, the warning names the family but not the Creality command set.
  - **Severity:** P3 stays. Wrong commands at Home and jog, and air timing, with no shown position
    or power error.
- **Fix direction:** Map a LightBurn file to a catalog profile when its name and size identify one,
  or list the controller family and command set under **Needs review** ("LightBurn's GRBL-LPC/GRBL-M3
  driver is not KerfDesk's controller; choose it in Connection options"). Extend the stale-preset
  identity warning to imported profiles whose bed and name match a preset.

## KNOWN (re-encountered, not raised)

| Item | Prior report | State |
|---|---|---|
| FluidNC `[13]1` / `[RST]#` Console lines unguarded | G4-P1-1 (C6-P3-1) | open on the tree; fixed by #1461 after it |
| Smoothieware Console `G20` inch reports read as mm | G4-P1-2 | open on the tree; fixed by #1461 after it |
| Camera calibration target and bed picture keep a stale bed frame after a setup change | G6-P2-1, G6-P2-3, G6-P2-2 | fixed by #1463 after the tree |
| Engrave-target / nudge-ring snapshot omits connection and settings observation | H1-P1-1 | pending (H1) |
| Remote Home runs with profile homing off | H8-P3-1 | pending (H8) |
| Setup enables Home without reading `$22`; Review never compares `$22` | E2-P3-2 | open (`DeviceSetupConfirmStep.tsx`, `device-setup-firmware-diff.ts` still read no `$22`) |
| An imported `.lfmachine.json` keeps the built-in identity it claims and values beyond the field caps | C7-P3-4 | open (`machine-profile-io.ts:385` keeps `profileSource`) |
| Open swaps the machine's no-go zones for the file's (same identity) | D5 KNOWN list / 12-P2-1 | folded into H4-P1-1; D5 deferred it ("a maintainer decision, not raised"), and no decision is recorded since (refuter) |
| Open keeps a shared file's "verified" scan-offset table (same identity) | controller v3 D8-P3-4 | open; folded into H4-P1-1's scan-offset half (refuter) |
| `.lbdev` import never sets `controllerKind`, so it cannot carry grblHAL identity | 2026-07-10 consolidated audit A.4.12 [POLISH] | open; folded into H4-P3-1 (refuter) |

## Refuted

Candidates checked and not raised:

- **Remote Home ignores Machine Setup's homing off.** True, but already H8-P3-1.
- **"Use detected values" copies `$130/$131` over a listed machine's work area.** By design:
  ADR-637 Amd 2 item 5 keeps it as the operator's explicit choice. Only the automatic fill protects
  the area.
- **A wizard draft saved over a project opened while setup is open.** The draft is keyed on
  `projectDocumentEpoch` (`DeviceSetupWizard.tsx:42-46`), so an Open starts a new draft.
- **Machine Setup, import or the banner changing the machine during a held job.** The store-level job
  machine lock (`job-machine-lock.ts:81-98`) refuses any setter that changes controller, bed,
  origin, homing, zones, Z, rotary or CNC values. It is wired at `store-setters.ts:5`.
- **Probe and surface-probe lines after a Console `G20` on GRBL.** Both send `G21` first
  (`grbl/probe.ts:113`, `laser-surface-probe-actions.ts:87`). Auto-focus was already refuted in G4.
- **An opened program writing `$` settings behind the snapshot.** `$` and bracket lines are refused
  (`normalize-external-program.ts:261-302`), and KerfDesk's own output emits none.
- **A Console `$H` leaving KerfDesk's homing evidence stale.** It is classified as `reference` and
  sets `homingState: 'unknown'` (`laser-console-actions.ts:364-371`).
- **Bed-reconciliation notice does not block Start.** The banner stays until a choice is made, and
  its content is G6-P2-2 (fixed by #1463).
- **Auto-connect opening a second machine with an identical adapter.** ADR-420 rule 1 asks whenever
  two granted ports match (`serial-port-memory.ts:31-43`).

## Verified clean

- **GRBL connect handshake against gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`
  `grbl/system.c`** (fetched 2026-10-27):
  - `$$` is refused only in Cycle/Hold ("Block during cycle. Takes too long to print.", ~L136-138),
    so ADR-674's settings read in Alarm is valid.
  - `$I` and `$#` sit behind the shared Idle/Alarm gate (~L171, L203-217).
  - `$G` has no state gate (~L140-143).
  - `$RST=` ends in `mc_reset()` (~L218-233). ADR-648 #3 treats its banner as uncommanded, and
    `noteControllerSettingWrite` counts the write.
  - KerfDesk's order matches: banner wait, `?`, fresh Idle or fresh Alarm, `$$`, `$I` (stock GRBL
    only), `$G` (`laser-controller-handshake.ts:84-245`).
- **Session stamping.**
  - The handshake clears settings, rows, build info and read time before `$$`, keeping only the
    report units (`laser-controller-handshake.ts:202-212`, `controller-report-units.ts:6-10`).
  - The native bed frame needs this session's settings and `$I` observation
    (`native-bed-frame.ts:134-144`).
  - The manual-motion limits read only this session's settings (`manual-motion-limits.ts:148-150`).
- **Settings writes retire what they change.** `grblSettingWriteEvidencePatch`
  (`grbl-settings-evidence.ts:15-51`) unqualifies the snapshot. A `$13` write marks report units
  unconfirmed. A coordinate-changing setting clears the homing state, WCO, origin, Work-Z and Frame
  proof.
- **ADR-648 retention** is kept only when no `$` write went out since the read and no read is in
  flight. Both write paths count writes.
- **CNC live caps** are cleared at every settings read, reset, disconnect, error stop and probe
  recovery, and republished from the new read or a kept owned-reset snapshot (`clearCncLiveCaps`
  and `publishCncLiveCaps` call sites in `src/ui/state`).
- **Interactive profile edits** reset a scan-offset table whose machine identity or bed changed, and
  a Z-travel confirmation whose travel changed (`device-profile-patch.ts:8-39`).
- **Every report-position consumer** reached in this journey (JogPad, head-move dispatch, job
  placement, board capture, camera head position) normalises `$13` inches.

## Not verified

- **Primary sources not re-fetched this round:** the grblHAL, FluidNC, Marlin and Smoothieware
  handshakes. D6 (controller v3) and C6 (controller v2) checked them at pinned SHAs. This audit
  re-read only KerfDesk's side: driver `settingsQuery`, `buildInfoQuery` and `modalStateQuery`, and
  the no-dump qualification path for Smoothieware and Falcon.
- **LightBurn device-file semantics:** `MirrorX`/`MirrorY` as the origin, and `S_Scale`. These rest on
  the 2026-09-25 OR track and the code comment; LightBurn's format is not published.
- **Catalogue presets** (Falcon, Neotronics, Ortur, xTool) were not re-checked against vendor pages.
  C7 and E2 did this on 2026-10-22, and the Neotronics note cites its sources.
- **H4-P1-1 and H4-P2-1** were reproduced at store and component level. The refuter's own runs
  used different values, and the KerfDesk-profile import path. Neither was run in a browser or on a
  machine.
- **The Falcon A1 Pro's startup banner** is unrecorded, so H4-P3-1's Falcon consequence is
  conditional (refuter).
- **Electron serial and network connect** were read for parity only. D7 owns the network link.

```json
[
  {"id":"H4-P1-1","severity":"P1","area":"machine-setup-connect","file":"src/ui/state/project-actions.ts","line":86,"anchor":"Contract: ADR-500 Amd 1 Decision 2 (Open must not silently replace the saved application machine); ADR-440 Amd 3 Context (next edit saves the file's profile as the app's machine); ADR-400 Amd 1 item 3 (a file can copy the identity that hides the notice); Twin: withCurrentMachineCamera/withCurrentMachineAutofocus keep only two fields (project-bed-reconciliation.ts:62-101); Twin (refuter): the job lock refuses the same file during a job as 'a different ... machine setup' (job-machine-lock.ts:35-50, ADR-416 Amd 2 Decision 2 lists origin, homing, no-go zones) while the Open notice compares only profileId|name|bed; PROJECT.md safety 1-2 (weak: output matches the profile in use)","evidence":"REPRO","verdict":"CONFIRMED","known":"in part: D5 KNOWN note (noGoZones, deferred as 'a maintainer decision, not raised'; no decision recorded); rolling-v2 12-P2-1 camera half fixed by #1437 (M6-P3-1); controller v3 D8-P3-4 (shared file's verified scan table). New: origin/homing position effect and the commit of the reverted machine by the next edit","summary":"Opening an older project for the same machine (same profile id, name, bed) silently reinstalls the file's copy of the machine: an origin corrected front-left to rear-left and a clamp zone added since are undone, the same line moves from G1 X20 Y20 to X20 Y380 and the no-go warning disappears, with no notice or toast; the next unrelated machine edit saves the file's copy as the app's last machine"},
  {"id":"H4-P2-1","severity":"P2","area":"machine-setup-connect","file":"src/ui/laser/device-setup/DeviceSetupIdentifyStep.tsx","line":31,"anchor":"Contract: ADR-637 Amd 1 item 2 (a choice asks before it replaces no-go zones, scan-offset, camera or rotary calibration, saved positions); Twin: DeviceSetupMachinePicker.tsx:143-150 machineChoiceReplaces vs import's direct apply-preset; ADR-440 Amd 3 Consequences (calibration goes only on recalibrate, another machine, or cleared data); ADR-232. Refuter: ADR-637 Amd 1 #2 is worded for list choices, so the L9 twin carries it","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Import KerfDesk profile / Import LightBurn .lbdev on the Machine stage dispatch apply-preset directly, so the draft's no-go zones and camera calibration (and scan table, rotary, saved positions) are replaced without the Replace settings? question a list choice on the same stage asks; repro: list choice prompts naming no-go zones and camera calibration, import leaves zones 0 and no camera with no prompt"},
  {"id":"H4-P3-1","severity":"P3","area":"machine-setup-connect","file":"src/io/lightburn/lbdev-import.ts","line":96,"anchor":"Twin: catalog Falcon A1 Pro preset grblhal + creality-falcon-a1-pro (falcon-profiles.ts:7) vs imported vendor file; stale-preset identity warning (controller-identity-warnings.ts:130-144) not applied to imports; lbdev-json.ts:6 names the Falcon bundle as a target","evidence":"REPRO","verdict":"CONFIRMED","known":"in part: 2026-07-10 consolidated audit A.4.12 (import never sets controllerKind, cannot carry grblHAL identity). New: the Falcon command set and the missing stale-preset warning","summary":"Any LightBurn driver containing 'grbl' (GRBL-LPC, GRBL-M3) imports with no controllerKind (stock GRBL) and no command set; Creality's Falcon A1 Pro file then connects with $H, $J= and $$ instead of $HX/$HY and G1 jogs, and Job Review shows no identity warning under a 'Grbl' banner. Refuter: an Ortur LM3 file is not silent, because its 'GrblHAL 1.1f' banner (ADR-660) raises the Job Review identity-mismatch warning"}
]
```
