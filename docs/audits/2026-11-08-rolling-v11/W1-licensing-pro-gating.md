# Rolling audit v11 — W1 Licensing and Pro gating

- **When:** 2026-11-08   **Tree:** main @ `5f09e1110` (repro tree: scratchpad `j10-main`, an export of that SHA)
- **Scope:**
  - Licence client: `electron/licensing-*.ts`, `electron/project-seal-key.ts`, `src/platform/electron/licensing.ts`.
  - Renderer gating: `src/ui/licensing/**`, `src/ui/state/pending-pro-project.ts`, the store guards (`store.ts`, `store-setters.ts`, `pro-operation-mutation.ts`, `project-edit-commit.ts`).
  - Every Pro entry point:
    - menus, toolbar, Ctrl+K and shortcuts (`edition-command-gate.ts`, `command-registry.ts`);
    - lessons;
    - project open, autosave and Recover unsaved work, templates, sheets, production rows;
    - camera (ADR-663);
    - phone/MCP writes (`src/ui/remote-control/**`);
    - the browser Free stub list (`scripts/browser-free-build.ts`, `PRO_BUILD_ENTRIES`).
  - The licensing service (`services/desktop-licensing/**`) and the website's Free/Pro copy.
  - Governing ADRs:
    - ADR-540 and Amendments 1–6;
    - ADR-592 and Amendments 2–3;
    - ADR-623 Amendments 2–3;
    - ADR-627;
    - ADR-663 (Free build boundary) and Amendment 2;
    - ADR-604 (command search).
- **Lenses run:**
  - L1 contract;
  - L5 trust boundary (token verification, seal, IPC entry routes, remote writes, secrets scan);
  - L9 entry-point parity;
  - L6 failure path (autosave, Recover, refusal dialogs);
  - L8 change risk, for the PRs merged in the area since 2026-10-21.
  - L2/L3 only where a twin showed up.
  - L7 (mutation testing) was not re-run, because memory stayed below the Vitest gate. See Not verified.
- **Counts:** 4 raised → 0 refuted (refuter pending) → P1 0 / P2 0 / P3 4 (+ 17 KNOWN, still open from rolling v2 02)
- **Security:** no SECURITY finding. Nothing found bypasses licensing, forges or replays a token, leaks a secret, or lets a remote party act past a Pro check. No `SECURITY-DETAILS.md` was written.

## Headline

Both P2s from the last audit of this area (v2 02, 2026-10-21) are fixed on main and reproduce as fixed:

- **02-P2-1.** My artwork Insert now asks for Pro: `pro ops 1 → 1, asks ["vcarve"]`.
- **02-P2-2.** A tapered inlay now counts as V-carve: `operationProFeature(tapered) = vcarve`.

ADR-592 Amendment 2's store-wide guard holds on every entry point checked. That covers menus, Ctrl+K, shortcuts, toolbar, lessons, camera, phone/MCP and project admission. No path was found that lets a Free user author new V-carve, relief or adaptive outlines.

What remains is low severity:

- **Duplicate sheet** copies Pro work without asking, while Ctrl+D on the same artwork asks.
- **Startup autosave recovery** checks the device seal without waiting for the seal key. Every other project reader waits.
- **File > Recover unsaved work** refuses a Pro autosave with the dialog meant for a file, and that dialog has no way to save a copy.
- **The website's Pro list** has drifted from the code.

Most v2 02 P3s are still open; they are listed below as KNOWN.

## Status of rolling v2 02 (licensing) findings at `5f09e1110`

| v2 ID | Status | Evidence |
|---|---|---|
| P2-1 My artwork Insert | **Fixed** (7e7b11975, ADR-592 Amd 2) | `personal-artwork-actions.ts:61-77` uses `commitProjectEdit`. REPRO `zz-w1/repro/v2-fixes.ts`: `pro ops before 1 after 1 asks ["vcarve"]` |
| P2-2 Tapered inlay | **Fixed** (7fb9f9093, ADR-540 Amd 6) | `pro-operation-policy.ts:20,27-29`. REPRO: `operationProFeature(tapered inlay) = vcarve`. Browser-Free test covers it at `browser-free-build.test.ts:136-140` |
| P3-1 Trial nonce wording | **Closed** by ADR-592 Amd 3 (116c45fdb), which withdraws the guarantee | `electron/licensing-grant.ts:100-114` checks no nonce; a trial is held to ±300 s only |
| P3-2 Retained-array Regenerate | **Fixed** (7e7b11975, 2dbdb340c) | `project-actions.ts:84-86` passes the guarded setter |
| P3-3 Barcode edit | **Fixed** (7e7b11975) | `commit-barcode.ts:75,79` use `commitProjectEditNow` |
| P3-4 Remote text edit reports ok; Pro dialog over a job | **Still open** (KNOWN) | `src/ui/remote-control/writes.ts:149-156` builds the receipt from the prepared fields, with no `needs_pro` pre-check. `ProFeatureDialog` still has no machine-activity hold, while `UpdatePrompt.tsx:37` has one |
| P3-5 "Your saved licence keeps working offline" said to everyone | **Still open** (KNOWN) | `electron/licensing-messages.ts:172` |
| P3-6 PROJECT.md:42 / dead paid check-in label | **Still open** (KNOWN) | `PROJECT.md:42`; `src/ui/licensing/EditionStatusButton.tsx:18` |
| P3-7 "Editable relief…" not labelled (Pro) | **Still open** (KNOWN) | `src/ui/commands/edition-command-gate.ts:14-20` has no `tools.editable-relief` entry; `artwork-creation-store.ts:12` gates it as `relief` |
| P3-8 Temporary decrypt failure rotates the seal key | **Still open** (KNOWN) | `electron/project-seal-key.ts:46-48` and `:80-82` |
| P3-9 Re-encrypt failure fails the read (latent) | **Still open** (KNOWN) | `electron/licensing-store.ts:168` |
| P3-10 Truncated key blamed on the service | **Still open, partly mitigated** (KNOWN) | Client accepts 8–256 characters (`licensing-store.ts:61-69`); `invalid_request` maps to NOT_UNDERSTOOD (`licensing-messages.ts:14-30`). The form note now flags a partial `KD1.` key (`LicenceKeyForm.tsx:98-99`) |
| P3-11 Update date UTC against local | **Still open** (KNOWN) | `electron/licensing-status.ts:108-110` against `LicencePanel.tsx:217` |
| P3-12 Surviving mutations | **Not re-verified** (no Vitest run, memory gate). The code is unchanged: `paddle.mjs:79` still uses `> 5`; `licensing-store.ts:168`. | — |
| P3-13 Renewal claim returns the rekeyed key | **Still open** (KNOWN) | `services/desktop-licensing/payments.mjs:213-216`, unchanged since 10-21 |
| P3-14 Trial hardware binding first-come | **Still open** (KNOWN) | `authority.mjs:127-128` |
| P3-15 Duplicated OEM UUID, no unbind route | **Still open** (KNOWN) | No admin route touches `trial-hardware:` |
| P3-16 Workers Logs and traces on | **Still open** (KNOWN) | `services/desktop-licensing/wrangler.jsonc:10-13` |
| P3-17 Single DO, coarse limits | **Still open** (KNOWN) | Service unchanged except the README |
| P3-18 README describes the removed paid rules | **Partly fixed** (KNOWN) | `README.md:84` was rewritten for ADR-592 Amd 3. `README.md:197` still says the app "applies its check-in deadline" after a refund |
| P3-19 Deleting a customer cancels an undelivered revocation | **Still open** (KNOWN) | `README.md:21` still says devices remove rights "at the next online refresh" |
| K-1 AGENTS.md "paid 30 days" | **Still open** (KNOWN) | `AGENTS.md:34` |

## Findings

### W1-P3-1 — Duplicate sheet copies V-carve, relief and adaptive work without asking for Pro, while Ctrl+D on the same artwork asks

- **Where:**
  - `src/ui/state/project-sheet-actions.ts:28-46` (`addProjectSheet`) and `:130-148` (`duplicateSheetDesign`) copy the whole design.
  - `:108` admits the copy with `setProject(trustProject(project))` through the unguarded document setter.
  - UI: "Duplicate active sheet" and "Duplicate editable design" (`src/ui/commands/ProjectSheetsBar.tsx:312,320`).
- **Anchor:**
  - Contract: ADR-540 Amendment 1 item 6, "Creating or copying Pro work asks for Pro even through operation sharing, settings paste, recipes, duplication and arrays".
  - Twin: `duplicateAction` is wrapped in `proOperationMutationSetter` (`store.ts:492`) and asks.
- **Scenario:**
  1. Run desktop Free (the default while ADR-623 Amd 3 holds the window off), or a session whose trial has ended.
  2. Open an admitted project with V-carve artwork.
  3. Ctrl+D on the artwork asks for Pro.
  4. "Duplicate active sheet" instead adds a second sheet holding the same V-carve operation and artwork, with no prompt. It repeats as often as wanted.
- **Evidence:** REPRO.
  - Script: `scratchpad/zz-w1/repro/sheet-dup.ts` (esbuild bundle of the j10-main sources, run in Node).
  - Output: `Ctrl+D in Free: project changed false asks ["vcarve"] vcBound 1`, then `Duplicate sheet in Free: … asks [] active sheet vcBound 1 vcBound across all sheets 2`.
- **Severity reasoning:** P3. The copies repeat artwork that was already admitted. Their outlines stay guarded on the new sheet, so no new V-carve design comes from this. It is the same class as v2 02-P3-2 (retained-array Regenerate), which was rated P3 and then fixed.
- **Novelty:** New. v2 02 listed "Sheets and production rows are trusted" under Verified clean. That covered switching sheets, not duplicating them.
- **Refuter:** PENDING
- **Fix direction:** Run the duplicate through the Pro copy admission (`newlyIntroducedProFeature` against an empty scene), or record an ADR line that keeps sheet duplication free.

### W1-P3-2 — Startup autosave recovery checks the device seal without waiting for the seal key; every other project reader waits

- **Where:**
  - `src/ui/state/autosave-record.ts:95-97` calls `trustIfSealedHere` when the record is read.
  - `src/ui/app/use-autosave.ts:151` reads the record before anything awaits `projectSealReady()`. Its `await initialLicenceStatus()` comes after the read, at `:162`.
  - The key loads asynchronously from `prepareDesktopWorkspace` (`src/ui/app/main.tsx:91-95`), and nothing waits for it.
- **Anchor:**
  - Twin: these readers all await `projectSealReady()` before checking the seal:
    - File > Open: `project-open-parser.ts:106`;
    - templates: `project-template-actions.ts:61`;
    - local snapshots: `local-project-snapshot.ts:34`.
  - Contract: ADR-592 decision 4: an autosave from this computer opens without Pro when its seal verifies here.
- **Scenario:**
  1. A desktop Free user (for example after the trial ended) has an unsaved V-carve autosave that this computer sealed.
  2. At launch the autosave read finishes before the main process has returned the DPAPI-decrypted key.
  3. `projectTextSealedHere` sees `key === null`, so the record is not trusted.
  4. `preserveUnadmittedProProject` then refuses the user's own work. The dialog says it "contains Pro operations that were not saved on this computer".
  5. The work is kept in recovery storage (`use-autosave.ts:167-168`). File > Recover unsaved work later re-reads it with the key loaded and restores it, so nothing is lost.
- **Evidence:** REPRO of the mechanism, plus READ of the ordering.
  - Script: `scratchpad/zz-w1/repro/autosave-seal.ts`, with the same sealed V-carve text and the key still loading.
  - Output: `autosave read while key loads -> unadmitted: ["vcarve"]`, against `File>Open while key loads -> unadmitted: []`.
  - Whether the race happens in the packaged app depends on DPAPI and IPC timing, which was not measured.
- **Severity reasoning:** P3. A false refusal with no data loss, and it only affects Free (Pro admits regardless of the seal). Reachability in the packaged app is PLAUSIBLE, not shown.
- **Novelty:** New.
- **Refuter:** PENDING
- **Fix direction:** Await `projectSealReady()` before `readLatest()` in startup recovery, or re-check the seal in `runAutosaveRecovery` after `initialLicenceStatus()`.

### W1-P3-3 — File > Recover unsaved work refuses a Pro autosave with the file dialog: "the file was not modified… open the project again", and no Save preserved copy

- **Where:**
  - `src/ui/app/restore-unsaved-work.ts:34-36` → `use-autosave.ts:193` calls `setProject(record.project)`.
  - `setProject` preserves with the default origin `{ source: 'project' }` (`src/ui/state/project-actions.ts:90`).
  - `ProProjectDesktopDialog.tsx:87-99` then shows the file wording and offers "Save preserved copy" only for `source === 'autosave'`.
- **Anchor:**
  - Twin: startup recovery preserves the same record with `{ source: 'autosave' }` (`use-autosave.ts:167`). It says the autosave stays in recovery storage and offers the copy.
  - Contract: ADR-540 Amendment 1 item 4: "Offer a portable copy before any Restore/Discard choice".
- **Scenario:**
  1. Desktop Free.
  2. A V-carve autosave this computer did not seal. Examples: one from before seals existed, or one after a seal-key rotation (v2 P3-8).
  3. File > Recover unsaved work → choose it → answer Save / Don't Save.
  4. The dialog tells the user to "open the project again", but there is no file. It offers no copy, so the work stays reachable only by unlocking Pro.
- **Evidence:** REPRO and READ.
  - Script: `scratchpad/zz-w1/repro/autosave-seal.ts` part (b).
  - Output: `restored false pending.source project edition desktop`.
  - The wording comes from `ProProjectDesktopDialog.tsx:89`.
- **Severity reasoning:** P3 (L6 wrong message). The autosave is not cleared, because the refusal returns before the re-home and clear. Nothing is lost.
- **Novelty:** New. The path came with ADR-688 (PR #1564), after v2.
- **Refuter:** PENDING
- **Fix direction:** Pass `{ source: 'autosave', name: null }` through the restore path, for example with a `setProject` option, so the autosave dialog and its copy button appear.

### W1-P3-4 — The website's Free/Pro copy has drifted from the code

- **Where:**
  - `website/pages/features-data.mjs` and `laser-data.mjs` list no "Place Board" at all. ADR-540 Amendment 5 made it Pro, and `pro-features.ts:13` lists it.
  - Commit 5077ca63a says it listed Place Board as Pro, but no page names it.
  - `website/pages/laser-data.mjs:170-179` describes "Camera overlay (Pro)" with these claims, which the code no longer matches:
    - Claim: "USB webcams work in the web and desktop apps". Code: browser Free strips calibration and the overlay (`PRO_BUILD_ENTRIES`; ADR-540 Amd 1 item 2, Amd 7: Pro is desktop only).
    - Claim: a checkerboard calibration. Code: ADR-663 calibrates from burned rings.
    - Claim: "click the four bed corners". Code: removed, per `src/ui/camera/NetworkCameraView.tsx:3`.
- **Anchor:** Contract: ADR-540 item 7 and Amendment 5, and ADR-663. Twin: `PRO_FEATURES` against the website's `pro: true` items.
- **Scenario:** A buyer reads that the camera overlay works in the web app and that Place Board is not a Pro tool. Neither is true.
- **Evidence:** READ (grep of `website/pages/*.mjs`).
- **Severity reasoning:** P3 doc drift. It overlaps W9 (platform/web/docs) for the camera wording, so the coordinator should de-duplicate.
- **Novelty:** New. v2 02 noted only the tapered-inlay omission.
- **Refuter:** PENDING
- **Fix direction:** Add Place Board to the Pro list and rewrite the camera items to match ADR-663 and the desktop-only Pro rule.

## Refuted

None. Two candidates were dropped before raising:

- **A project file's camera calibration loads in Free** (`project-bed-reconciliation.ts:142-157`). A calibration belongs to one camera and machine, it is existing work, and it gives a stranger nothing.
- **Production rows re-render variable text on V-carve artwork without asking.** ADR-592 / `pro-operation-policy.ts:92-94` explicitly keep record and serial progression within an admitted dataset Free.

## Verified clean

- **Entry-point parity (L9).**
  - Every menu, Ctrl+K result, context menu and shortcut runs from one gated list: `command-registry.ts:75` → `gateCommandsForEdition`, labelled by `use-app-commands.ts:109`.
  - Design Studio opens only from the gated toolbar button (`DesignStudioButton.tsx:16`).
  - The box generator opens only from its gated command (`CommandShell.tsx:99`).
  - STL and height-map import use `whenPro` (`import-dispatch.ts:318-357`).
  - Trace presets are gated at choice and at initial preset (`dialog-parts.tsx:86-91`, `use-trace-preset.ts:18`).
  - Every camera calibration, nudge and check opener asks (`CalibrateCameraControls.tsx:34-61`, `CameraMovedNotice.tsx:38,46`, `CameraSetupCallout.tsx:49`). The only other caller, `NudgeSteps.tsx:207`, sits inside an already admitted wizard.
  - Lessons are read-only illustrations. They now carry a Pro badge (`TutorialProBadge.tsx`; V8-P3-5 KNOWN, not re-raised).
- **Phone/MCP.**
  - These refuse with `needs_pro` in Free:
    - `place_on_board` and `set_board_photo` (`remote-control/board.ts:43,61,143-145`);
    - board capture and finish (`machine-actions.ts:168`);
    - assigning artwork to a Pro operation (`design-operations.ts:86`);
    - choosing a Pro strategy, tapered inlay included (`design-operations.ts:187`);
    - arrange (`arrange.ts:156`).
  - Remote import accepts only SVG, DXF and raster, so no `.lf2` and no admission bypass. A refused remote import throws rather than reporting ok.
- **Store guard.**
  - The ADR-592 Amd 2 lint rule has only two justified disables (`use-polyline-fairing-upgrade.ts:12`, `reveal-reviewed-artwork.ts:41`).
  - The four UI modules that commit outside the store all pass through `proOperationMutationSetter`: fixture templates, fixture review, joint resize and stamp.
  - The only `trustProject` callers are sheet switching and production rows of the open, admitted document.
  - CNC text never defaults to V-carve without Pro (`text-layer-policy.ts:11-16`).
  - Material recipes are laser-only, so they cannot set `cnc` (`material-library.ts:107-123`).
  - Object operation overrides carry no `cnc` (`scene-object.ts:107-156`).
  - Sub-layers drop `cnc` (`layer.ts:426-438`).
- **Project admission.** `setProject` (`project-actions.ts:89-91`) is the one door, and these paths all reach it:
  - File > Open;
  - OS open, which waits up to 10 s for the first status (`external-project-open.ts:88`);
  - templates;
  - startup autosave and File > Recover unsaved work;
  - sheets;
  - production rows.

  Inactive sheets, production designs and retained-array archives are scanned too (`project-workflow-archives.ts:33-45`).
- **Seal (L5).**
  - The preserved copy is never sealed (`preserved-pro-project-copy.ts`).
  - Only admitted documents are sealed: saves, templates, snapshots and autosave.
  - The sealed tail is a strict regex at the end of the text, and the body is exact, so a seal cannot be moved to other content.
- **Edition default.** Packaged desktop always loads `app://app/index.html` (`trusted-renderer-policy.ts:40-47,168-172`), so `startLicensedEditionLocked` runs before any render (`main.tsx:89`). The unrestricted default edition is reachable only in dev-server builds.
- **Client crypto and clock after ADR-592 Amd 3.**
  - `verifyGrant` (`licensing-grant.ts:106-114`) verifies signature and device, then holds trial and developer grants to ±300 s. Paid grants are exempt, as ADR-623 Amd 2 says.
  - Trial expiry, clock rollback and the 3-day check-in read the signed `issuedAt` (`licensing-clock.ts:19-21,82-90`; `licensing-status.ts:166-183`).
  - Edition is Pro only for a commercial channel with `ready` rights, or a session already latched (`licensing-status.ts:91-95`).
- **L8: PRs merged in the area since 2026-10-21.**
  - 7e7b11975, 2dbdb340c, 7fb9f9093 and 116c45fdb were reviewed above.
  - 0db717973 (#1475) changes update wording only.
  - 6c6082152 (ADR-663) adds `CameraCalibrationWizard` to `PRO_BUILD_ENTRIES` (`browser-free-build.ts:16`), and its new openers ask.
  - dbfa20e77 (#1582) changes only the licence form's submit (`noValidate` + `checkedSubmit`). The Activate button still enables at 8 characters, so a paying user can still activate.
  - 3f262fa83 and 7763eece0 are wording and a11y only.
- **Secrets.** A `git grep` at `5f09e1110` found no Paddle, Stripe, AWS, GitHub or Slack tokens, private keys, or long literal `secret`/`token`/`apiKey` values. It covered `services`, `electron`, `website`, `public`, `scripts` and `.github`.

## Not verified

- **Vitest and browser e2e.** Neither was run: available memory stayed between 648 and 997 MB, below both gates. The repros were Node runs of esbuild bundles of the j10-main sources (`scratchpad/zz-w1/repro/build.mjs`). v2 P3-12 (mutation survivors) was therefore not re-run.
- **The W1-P3-2 race in the packaged app.** DPAPI and IPC key-load time against the IndexedDB/locks autosave read was not measured, and the installed KerfDesk was not launched (per the rules).
- **The live licensing Worker, Paddle and Cloudflare behaviour.** Not tested, per the rules. Server findings P3-13 to P3-17 and P3-19 are carried forward because the service source is unchanged except the README; they were not re-reproduced.
- **The browser Free bundle.** Not rebuilt. The stub list was checked by reading `PRO_BUILD_ENTRIES` and the existing test at `browser-free-build.test.ts:100-140`. That test does not compile a relief operation in Free; relief objects cannot be admitted or created there, so this was not pursued.
- **The MCP transport.** Checked only through the shared remote-control write handlers, separately from the phone.

```json
[
  {"id":"W1-P3-1","severity":"P3","area":"licensing-pro-gating","file":"src/ui/state/project-sheet-actions.ts","line":28,"anchor":"Contract: ADR-540 Amd 1 item 6 (duplication); Twin: duplicateAction via proOperationMutationSetter (store.ts:492)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Duplicate active sheet / editable design copies V-carve, relief or adaptive work in Free with no Pro prompt, while Ctrl+D on the same artwork asks"},
  {"id":"W1-P3-2","severity":"P3","area":"licensing-pro-gating","file":"src/ui/state/autosave-record.ts","line":97,"anchor":"Twin: project-open-parser.ts:106, project-template-actions.ts:61, local-project-snapshot.ts:34 await projectSealReady; Contract: ADR-592 decision 4","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Startup autosave recovery checks the seal before the seal key loads; a Free user's own sealed Pro autosave can be refused as not saved here (kept in recovery)"},
  {"id":"W1-P3-3","severity":"P3","area":"licensing-pro-gating","file":"src/ui/state/project-actions.ts","line":90,"anchor":"Twin: use-autosave.ts:167 preserves with source autosave; Contract: ADR-540 Amd 1 item 4","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"File > Recover unsaved work refuses an unadmitted Pro autosave with the file dialog (open the project again) and no Save preserved copy"},
  {"id":"W1-P3-4","severity":"P3","area":"licensing-pro-gating","file":"website/pages/laser-data.mjs","line":170,"anchor":"Contract: ADR-540 item 7, Amd 5, ADR-663; Twin: src/ui/licensing/pro-features.ts","evidence":"READ","verdict":"PENDING","known":false,"summary":"Website omits Place Board as Pro and says the Pro camera overlay works in the web app with checkerboard and four-corner alignment, none of which matches the code"}
]
```

## Refuter (2026-11-08)

Fresh refuter, main @ `5f09e1110` (repro tree `j10-main`). All repros are Node runs of esbuild bundles of the j10-main sources (the auditor's `build.mjs`), in `scratchpad/zz-w1r/repro/`. Available memory stayed at 590–665 MB, below both the Vitest and browser gates, so no Vitest or browser run was made.

### Verdicts

| ID | Verdict | Severity | Pinned evidence |
|---|---|---|---|
| W1-P3-1 | **CONFIRMED** (REPRO, and a second door found) | P3 | See below |
| W1-P3-2 | **REFUTED** (REPRO) | — | See below |
| W1-P3-3 | **CONFIRMED** (READ, plus the auditor's REPRO re-run) | P3 | See below |
| W1-P3-4 | **CONFIRMED in part**: the camera claims stand; the Place Board half is wrong | P3 | See below |

**W1-P3-1 — CONFIRMED, P3.**
- Re-running `zz-w1/repro/sheet-dup.bundle.mjs` gives the auditor's output: `Ctrl+D in Free: project changed false asks ["vcarve"]`, then `Duplicate sheet in Free: … asks [] … vcBound across all sheets 2`.
- What would make it false is an upstream ask. There is none: `addProjectSheet` (`src/ui/state/project-sheet-actions.ts:28-46`) admits the copy through `replaceSheetProject` → `setProject(trustProject(project))` (`:100-108`). That runs on `documentSet` (`project-actions.ts:80-82`, `store.ts:443`), which has no Pro guard (`store-setters.ts:24-29`).
- **Second door, same root cause.** Quantity production sheets copy Pro-bound parts into up to 99 new sheets without asking.
  - Where: `production-nest-actions.ts:44-67` → `materializeProductionSheets` (`production-nest-sheet-materialize.ts:27-80,90-135`). It keeps the design's operations and clones the placed objects onto them.
  - The actions get the plain `set` (`store.ts:488`). Its only Pro check, `freeProArtworkSetter`, compares the active scene alone (`pro-operation-mutation.ts:31`), and the new sheets are inactive archives.
  - `src/ui/commands/use-production-nest-review.ts` never calls `requestPro`.
  - Evidence: READ only, so it is counted inside W1-P3-1, not as a new ID.
- Severity stays P3. The copies repeat admitted artwork. Their outlines stay guarded once a sheet is active, so this is the v2 02-P3-2 class.
- The fix should cover both doors. One way is to scan `sheetBook.inactive` in the guard (see W1-P3-5).

**W1-P3-2 — REFUTED.** The auditor's repro calls `readAutosaveRecord` directly and so skips the wait that the startup path has.
- Startup recovery reads through `service.readLatest()` (`use-autosave.ts:151`) → `ProjectAutosaveService.readLatest` (`autosave-durable.ts:178-183`) → `readLatestDurableAutosave` → `readDurableAutosaves`.
- `readDurableAutosaves` runs `await projectSealReady();` (`src/ui/state/autosave-durable-read.ts:62`, in place since f9c12c737 on 2026-10-12) before it parses any local or IndexedDB record (`:65`, `:76`, `:174`).
- File > Recover unsaved work reads through the same function (`autosave-durable.ts:192-196`).
- `projectSealReady()` returns the key-load promise, because `installProjectSealKey` (`project-seal.ts:24-37`) has already been called. The packaged desktop gate calls `onNativeReady` → `prepareDesktopWorkspace` → `installProjectSealKey` synchronously, before `setState('ready')` mounts any child (`DesktopStartupGate.tsx:40-41,57`; `main.tsx:91-96`).
- No other production reader exists. `readAutosave`/`readLocalAutosave` (`autosave.ts:34`, `autosave-local-storage.ts:104`) have no non-test caller.
- REPRO `zz-w1r/repro/startup-seal.ts` uses the same sealed V-carve text, desktop Free, and a key that resolves 200 ms after recovery starts:
  - `(1) readAutosaveRecord direct, key loading -> unadmitted ["vcarve"]` (the auditor's call)
  - `(2) readLatestDurableAutosave -> key loaded after 203 ms; unadmitted []`
  - `(3) runAutosaveRecovery in Free with key loading: Restore offered true | refused/retained false | pending dialog null`
- **The questions asked, answered for completeness:**
  - **The refusal never happens.** In the hypothetical where it did, nothing is lost, because a refused record is retained (`use-autosave.ts:167-169`). No cleanup deletes it: no expiry or pruning exists in `autosave*.ts`, and Recover lists it until it is restored or discarded.
  - **A paying Pro user is not affected.** Pro admits regardless of the seal (`pending-pro-project.ts:38`). If the first licence status takes more than 10 s (`edition.ts:80-95`), a sealed autosave is still admitted by its seal. An unsealed one is retained with the autosave dialog and its copy button, and File > Recover restores it once status arrives.

**W1-P3-3 — CONFIRMED, P3 (wrong message and a missing button; no work lost).**
- Reproduced with `zz-w1/repro/autosave-seal.bundle.mjs`: `(b) restored false pending.source project edition desktop`.
- `restoreAutosaveSnapshot` calls `setProject(record.project)` (`use-autosave.ts:193`). That preserves with the default `{ source: 'project' }` (`project-actions.ts:89-91`; `pending-pro-project.ts:85-88`), so the dialog shows the file wording and no "Save preserved copy" (`ProProjectDesktopDialog.tsx:86-99`).
- Is work lost? No.
  - The refusal returns before the re-home write and the clear (`use-autosave.ts:194` against `:211-213`), so the autosave slot stays and is listed again by File > Recover (`autosave-durable.ts:192-196`).
  - Unlocking Pro (trial or key) and choosing Recover again restores it.
  - If it is the newest slot, the next empty launch offers it through startup recovery with the correct autosave dialog and copy button (`use-autosave.ts:167`).
- One side effect, which is not a loss: if the user answered **Don't Save** for the dirty open document, that document's own autosave slot is cleared (`confirm-discard.ts:35-43`) before the refusal. The document stays open and dirty. The next 30 s tick re-writes it, because the clear bumps the slot generation that releases the tick memo (`autosave-loop.ts:53-64`), so a crash in that window is the only exposure. The user had just chosen to discard that document.
- Reach: only an unsealed Pro autosave gets here. That means one from before seals, or one written while the key was unavailable (v2 P3-8), because `writeNow` awaits the key and seals (`autosave-durable.ts:259-265`).

**W1-P3-4 — CONFIRMED in part, P3.**
- The camera half holds:
  - `website/pages/laser-data.mjs:172` still claims checkerboard calibration and "USB webcams work in the web and desktop apps".
  - `:179` still offers "the four bed corners", which `NetworkCameraView.tsx:3-4` says is gone.
  - Browser Free strips the calibration wizard and overlay (`scripts/browser-free-build.ts:14-18`).
- The Place Board half is wrong. `website/commerce.config.mjs:43-51` lists "Place Board" among the Pro features, and the website pages draw the Pro list from it. The FAQ, download and licence pages import it, and `website/tests/commerce.test.mjs:180` pins the sentence "…Registration Jig, Place Board, Box generator and Design Studio are in KerfDesk Pro…".
- What remains is that the feature cards (`features-data.mjs`, `laser-data.mjs`) have no Place Board card. That is an omission, not a claim that it is Free.

### Challenges to "Verified clean"

Each item names what was checked. None produced a new finding beyond W1-P3-5.

- **Clock rollback during offline grace.**
  - Trial check-in and expiry read the signed `issuedAt` and the saved high-water mark: `licensing-clock.ts:18-20` (rolled back) and `:66-75` (check-in overdue).
  - `TrialSessionClock` never moves backwards inside a session (`licensing-trial-clock.ts:48-69`).
  - The only extension is to restore an older `commercial-licence.v1` and wind the clock back. That gives at most issuedAt + 3 days each time, and it is the accepted same-user restore: ADR-592 "What is still accepted" and ADR-523:70, "A modified client or restored local state can defeat local controls".
  - Paid rights never read the clock, by design (ADR-623 Amd 2).
- **Storage edits.**
  - The licence record is OS-encrypted and shape-checked (`licensing-store.ts:87-115,149-170`). Rights still need an Ed25519 entitlement bound to the device (`licensing-verification.ts:36-84`). Editing `lastSeenAt` needs same-user DPAPI tooling, which is accepted.
  - The renderer's edition comes only from the main process's status (`licensing-status.ts:93-96`). `sessionAdmitted` only admits the workspace window, never Pro (`EditionProvider.tsx:221`).
  - Renderer IndexedDB and localStorage hold autosaves, templates, snapshots and personal artwork. Projects among them are sealed or refused. Personal artwork Insert is guarded (v2 P2-1 fixed).
  - Material-library recipes may carry V-carve steps (`process-recipe.ts:36`; parser `process-recipe-io.ts:164-177`, no tier check). Applying one asks in the UI (`use-process-recipe-controls.ts:79-82`, `use-machining-template-review.ts:80-84`), and the active-scene store guard asks too. The inactive-sheet store path does not ask; that is W1-P3-5.
- **A token for one machine on another.** The device ID is a digest of `MachineGuid` (`licensing-device.ts:80-106`), and the grant is bound to it (`licensing-verification.ts:77`). Moving a licence needs the other machine's DPAPI-protected record plus an administrator registry edit, which is same-user/admin tooling. ADR-592 context 2 acknowledges `MachineGuid` is editable, and "What is still accepted" covers safeStorage reads.
- **Revocation.**
  - `dropRevokedRights` clears rights and the session latch on `license_revoked`/released codes (`licensing-runtime.ts:236-256`). `rejectedEntitlement` keeps that binding even if the write fails (`:121-122`; `licensing-grant.ts:186-194`).
  - A paid device that never comes online keeps Pro. That is ADR-623 Amd 2 (LightBurn parity) and ADR-523:72-73.
- **Pro output.** ADR-592 "Unchanged" keeps Save G-code, Start and Frame ungated for admitted work. Free can only reach unadmitted Pro work through:
  - File/OS open: the seal check runs after the key (`project-open-parser.ts:106-110`).
  - Templates (`project-template-actions.ts:61-62`) and snapshots (`local-project-snapshot.ts:34`).
  - Recovery: the seal check runs after the key; W1-P3-2 is refuted.
  - Phone/MCP: no `.lf2` import. Remote writes use the store setters or `needs_pro` (`design-operations.ts:86,187`; `arrange.ts:156`; `board.ts:144`; `machine-actions.ts:168`), and remote save writes to the existing target only (`design-save.ts:17-43`).
  - Sheets and production rows of an admitted document: W1-P3-1 and W1-P3-5.
- **Seal key (v2 P3-8, KNOWN).** Re-checked at `electron/project-seal-key.ts:44-62,76-81`.
  - A decrypt failure renames the key file aside (never deletes it) and creates a new key.
  - No project, autosave or file is deleted or rewritten. Files sealed earlier open with Pro, are refused untouched in Free, and an autosave sealed earlier is retained (`use-autosave.ts:167-169`).
  - It cannot lose data. It stays P3 (KNOWN): Free users lose admission for earlier seals, which ADR-592 accepts for a reset account.
- **Secrets and routes.**
  - `project-seal-key` is served only through `trustedAppRequest` (`licensing-routes.ts:42-43,223-243`; `app-route-guard.ts:7-27`).
  - No remote-control or MCP module references the seal (grep of `src/ui/remote-control`, `electron/mcp`, `electron/remote-access`).

### New findings

#### W1-P3-5 — The store's Pro guard does not look at inactive sheets, so applying a V-carve machining template to another sheet through the store commits without asking (latent; the UI asks) — found by refuter

- **Where:**
  - `src/ui/licensing/pro-operation-policy.ts:36` and `:52` return `null` when `before.scene === after.scene`.
  - `applyRecipeSheets` (`src/ui/state/process-recipe-actions.ts:222-252`) rewrites only `sheetBook.inactive[].projectJson` when the active sheet is not selected (`process-recipe-sheet-application.ts:113-129`). The active scene is therefore unchanged, and `proOperationMutationSetter` (`store.ts:468`) commits.
  - Switching to that sheet then trusts it (`project-sheet-actions.ts:108`).
- **Anchor:**
  - Contract: ADR-592 decision 5, "through every store edit path except history, document replacement and save tracking".
  - Contract: ADR-540 Amd 1 item 6 (recipes).
  - Twin: the same template applied to the active selection asks (`newlyIntroducedProOperationFeature`, `pro-operation-policy.ts:48-61`).
- **Scenario:**
  1. Desktop Free, with an admitted V-carve design (sealed during a trial, for example).
  2. Save its machining template, which only writes the library and needs no Pro.
  3. Add a sheet with new, unrelated artwork, then switch back.
  4. Call `applyProcessRecipeToSheets(id, [otherSheet], signature)`.
  5. It commits with no ask. Switching to that sheet gives the new artwork a V-carve operation, and it compiles.
- **Evidence:** REPRO `zz-w1r/repro/recipe-sheets.ts`:
  - `template saved (admitted design): ok [ 'v-carve' ]`
  - `Free: apply template to inactive sheet via store -> {"kind":"ok","value":1} asks [] project changed true`
  - `Free: after switching to that sheet: v-carve bound ["newart"] ops [ 'v-carve' ]`
- **Severity reasoning:** P3, latent.
  - The only caller is `use-machining-template-review.ts:63-84`. It asks `requestPro(recipeProFeature(recipe), run)` before calling the store, so no shipped UI, remote or MCP path reaches the store call (grep: no other caller).
  - It is the same defence-in-depth gap ADR-592 Amd 2 closed for the active scene. It also explains why W1-P3-1's two doors are not caught.
  - Not SECURITY: it needs a modified renderer, which ADR-544 already accepts as defeating any client check.
- **Fix direction:** Have the Pro guard compare inactive sheet archives too: decode changed `sheetBook.inactive` entries and run `newlyIntroducedProFeature` against the archive's previous version. That one change also covers W1-P3-1 (duplicate sheet, quantity production sheets).

### Security

No SECURITY finding. Nothing found forges or replays a token, leaks the seal key or any secret, or lets a remote party get past a Pro check. Every local bypass seen needs same-user tooling or a modified client, which ADR-544, ADR-592 and ADR-523 accept. No `SECURITY-DETAILS.md` was written.

### Not verified (refuter)

- No Vitest or browser run (memory 590–665 MB).
- The production-sheet door in W1-P3-1 is READ only. No nest repro was built.
- The packaged app's DPAPI and IPC timing was not measured. W1-P3-2 is refuted by ordering, not by timing: the wait is an `await` on the load promise itself.
- Live Worker, Paddle and Cloudflare were not touched. The KNOWN v2 server items were not re-run.
- Of the KNOWN rows, only P3-4 (`writes.ts:149-156`), P3-5 (`licensing-messages.ts:172`), P3-7 (`edition-command-gate.ts:14-20`), P3-8 and K-1 (`AGENTS.md:34`) were spot-checked; all are still present.

```json
[
  {"id":"W1-P3-1","verdict":"CONFIRMED","severity":"P3","note":"second door: quantity production sheets (production-nest-actions.ts:44-67) copy Pro-bound parts with no ask; READ"},
  {"id":"W1-P3-2","verdict":"REFUTED","severity":null,"note":"readDurableAutosaves awaits projectSealReady (autosave-durable-read.ts:62) after the startup gate installs the key (DesktopStartupGate.tsx:40-41); repro startup-seal.ts admits"},
  {"id":"W1-P3-3","verdict":"CONFIRMED","severity":"P3","note":"no work lost: slot kept (use-autosave.ts:194 before :211-213) and relisted"},
  {"id":"W1-P3-4","verdict":"CONFIRMED in part","severity":"P3","note":"camera claims stand; Place Board is listed as Pro in commerce.config.mjs:43-51"},
  {"id":"W1-P3-5","severity":"P3","area":"licensing-pro-gating","file":"src/ui/licensing/pro-operation-policy.ts","line":36,"anchor":"Contract: ADR-592 d5, ADR-540 Amd 1 item 6; Twin: active-selection template apply asks","evidence":"REPRO","verdict":"found by refuter","known":false,"summary":"Store Pro guard compares only the active scene; a V-carve template applied to an inactive sheet via the store commits without asking (UI asks first, so latent)"}
]
```

Refuter counts: raised 1, refuted 1, P1 0, P2 0, P3 4, known 17
