# Rolling audit v10 — V7 Fix: design and burn safety

- **When:** 2026-11-08, 06:30–07:30 +0800   **Tree:** origin/main @ `5f09e1110` (reads in the scratchpad tree `j10-main`; Vitest runs in my own export `scratchpad\zz-v7\mut`, made with `git archive 5f09e1110`, with a `node_modules` junction to the main checkout and the `fflate` alias config copied from zz-v6).
- **Scope:** the four fix PRs and their ADRs:
  - #1556 (ADR-686): white fills in an imported SVG are knocked out.
  - #1561 (ADR-480 Amd 2, ADR-687): Cut last warning, beginner notes first.
  - #1566 (ADR-689): Job Review's "Before you start" block.
  - #1564 (ADR-688): recovery card, File > Recover unsaved work (`readRecent`), browser-without-pickers notice.
  - Original findings: U3-P2-2, U3-P2-4, U4-P2-6, U4-P2-1, U1-P2-3, U1-P2-1.
- **Lenses run:** L10 (all five steps), L3 (knock-out geometry against the SVG painting model; burn against canvas), L9 (entry points: file import, Re-import, Design Studio apply, Remote; every burn route for the safety block; startup card and File > Recover), L1 for the five ADRs, and L4 for recovery (multiple windows, unload copy, private mode, storage failure).
  - L12 only partly: the PRs' 14 focused suites were run, but no e2e spec. Available memory was 2.29–2.49 GB all session, under the 3 GB browser gate.
  - No hardware was used.
- **Counts:** 7 raised → refuter pending → P1 1 / P2 3 / P3 3 (+ 2 KNOWN: V2-P2-1 and the update-notes gap, not re-raised).

## Headline

**#1564 added a way to lose unsaved work.** When a dirty tab closes, the same session's autosave survives twice: the 30-second IndexedDB copy, and the newer copy that `beforeunload` writes to localStorage. Both copies use one storage key.
- File > Recover unsaved work lists them as two separate rows.
- Restoring the older row clears the storage key, which deletes the newer copy for good. What is lost is every edit made after the last 30-second write. The interval does not write while a job streams, so for work done during a burn that can be the whole job's length.
- Reproduced with the real autosave service and fake IndexedDB (V7-P1-1).

**#1556 fixes the U3 logo, but its test for "white" ignores opacity and gradients.**
- A 15 % white highlight over black is ink in the file. KerfDesk cuts it out as paper, and so does a gradient emblem whose first stop is white.
- In both cases the toast says the shape "will not burn, as in the file" (V7-P2-1).
- Re-importing an unchanged logo that has white shapes now resets its operations to defaults, against ADR-358 Decision 6 (V7-P2-2).

**#1561's cut-last warning catches one coaster but not two.** It compares whole operations, so two coasters on one cut operation, or one coaster plus any engraving elsewhere, get no warning (V7-P2-3).

**#1566 holds on Job Review, the phone/MCP Start and Ctrl+K Start.** It never touches Abort. Four other burn routes have no safety words (V7-P3-1).

## Findings

### V7-P1-1 — File > Recover unsaved work lists one closed session twice (its interval copy and its newer unload copy); restoring the older row permanently deletes the newer one

- **Where (5f09e1110):**
  - `src/ui/app/use-autosave.ts:102-115`: `beforeunload` writes the dirty project synchronously to localStorage under the session's key.
  - `src/ui/state/autosave-loop.ts:95-96`: the 30-second loop skips writing while a job streams.
  - `src/ui/state/autosave-durable-read.ts:88-107`: the read takes the local copies, then pushes every IndexedDB slot as another candidate. Nothing merges two candidates that share a `storageKey`.
  - `src/ui/state/autosave-durable.ts:192-197`: `readRecent` returns them all, minus `ownership: 'current'`.
  - `src/ui/app/UnsavedWorkDialog.tsx:93-97`: renders every snapshot as its own row (React key `storageKey@savedAt`).
  - `src/ui/app/use-autosave.ts:211-213`: restore re-homes the snapshot, then calls `clearRecovered(record)`.
  - `src/ui/state/autosave-durable.ts:311-314`: `clearSnapshotNow` runs `clearAutosave(snapshot)`, which removes the localStorage key `snapshot.storageKey`. That key is the one the newer unload copy lives under, so it goes whichever row was chosen.
- **Anchor:**
  - **Contract, ADR-688 Decision 3** (`docs/decisions/ADR-688-…-stays-reachable.md:37-44`): `readRecent()` "returns every eligible slot newest first". The code returns copies, not slots. The same decision says unsaved slots "are still removed only by Restore, by Don't Save on the restored document, or by the existing unreadable-slot retirement". Here a Restore on one row removes another row's newer content.
  - **Twin:** startup recovery (`readLatest`, `snapshots[0]`) always takes the newest copy. Only the new list exposes the older one.
- **Scenario:**
  1. A user draws or edits. During a 20-minute burn they also lay out the next design, because the loop does not autosave while streaming. They then close the tab (the browser's Leave-site prompt → Leave).
  2. Next launch, the card offers the newest copy. They click **Start fresh** (or draw, which retires the card).
  3. Later, File > Recover unsaved work shows two rows, for example "12 objects, Autosaved 8 Nov 2026 06:10 (3 minutes ago)" and "9 objects, Autosaved 8 Nov 2026 05:49 (24 minutes ago)". They look like two sessions.
  4. They restore the second row. The 12-object version is deleted from localStorage, and no row or card reaches it again.
- **Evidence:** REPRO (Vitest, real modules; `zz-v7\mut\src\zz-v7\recover-probe.test.ts`, run with `NODE_OPTIONS=--no-experimental-webstorage`; output `zz-v7\recover.json`).
  - **Setup.** Session A: `service.write(project('interval copy (older)'), 1000)` to IndexedDB, then `writeAutosave(project('unload copy (newest edits)'), 1020, { sessionId: 'session-a' })`, the unload path, then `stop()`.
  - **Session B, the next launch:**
    - `readLatest` gives the "unload copy (newest edits)".
    - `readRecent` returns two entries for `lf2:autosave:v1:session-a`: local at 1020 and indexeddb at 1000.
    - Restoring the indexeddb entry exactly as `restoreAutosaveSnapshot` does (`write` then `clearRecovered`) returns `{kind: "ok"}`.
  - **Session C:** the only snapshot left is "interval copy (older)", re-homed into session B's key. `localStorage` has no keys. The newest edits are gone.
  - **UI layer:** READ only. The dialog code above renders both rows with no merge. Not rendered in a browser (memory gate).
- **Severity:** P1. METHOD §3: it "loses … user data", and P1 has no reach clause.
  - **Reach.** The unload copy is written on every dirty close whose project fits in localStorage, so duplicate rows are the normal state after a dirty close.
  - **How much is lost.** At least the edits since the last 30-second write. When the user edited during a job, it is every edit since the job started.
  - **No warning.** The user is told only "Restored unsaved work".
- **Novelty:** new. Introduced by #1564: before it, only `readLatest` (newest copy) was reachable, and its restore clearing the older copy was harmless. No audit or open PR touches it (searched `docs/audits` for readRecent, unload copy, Recover unsaved work; checked the open PR list).
- **Fix direction:**
  - In `readDurableAutosaves`, keep one candidate per `storageKey`: the newest by `savedAt`, falling back to the other only if the newest is unreadable.
  - Or have `clearSnapshotNow` clear the local key only when the local copy is not newer than the restored snapshot.
  - Add a test with an IndexedDB copy plus a newer local copy for the same session.
- **Refuter:** PENDING.

### V7-P2-1 — The knock-out takes any `#ffffff` paint as paper, including semi-transparent white and gradients whose first stop is white; a highlight becomes a hole, a gradient emblem disappears, and the toast says "as in the file"

- **Where:**
  - `src/core/geometry/white-fill-knockout.ts:128-130`: `isWhite` compares the colour only.
  - The parser keeps `#ffffff` for any opacity above 0:
    - `src/io/svg/svg-paint.ts:82`: `color.alpha > 0` keeps the hex, so `rgba(255,255,255,0.25)` becomes `#ffffff`.
    - `src/io/svg/parse-svg.ts:256`: only `fill-opacity <= 0` drops a fill; `opacity` and `fill-opacity` are otherwise not applied.
    - `src/io/svg/svg-paint-server.ts:81-86`: a gradient paints as its first visible stop.
  - The notice: `src/ui/app/import-white-knockout-notice.ts:20-24`.
- **Anchor:**
  - **Contract, ADR-686 Decision 1** (`docs/decisions/ADR-686-white-fills-in-an-imported-design-are-paper.md:35-40`): a fill "painted pure white". A 15 % white fill over black paints `#262626`, not white.
  - The ADR's "Not covered" list (`:64-73`) names PDF, DXF, white strokes, near-white, paste and trace. It does not name opacity, gradients or masks.
  - **Twin:** the SVG painting model (alpha compositing of `fill-opacity` and `opacity`). The ADR's own Context says the knock-out exists so the burn matches what the file shows.
- **Scenario:** every case below is a fresh import on main through the store's `importSvgFragment`, compiled with `compileJob`. "Lit inside" is the lit length inside the white shape's box (0.2 mm inset), before the knock-out (the Undo state) and after it.

  | SVG (black 40 × 40 square under a 20 × 20 shape) | What the file shows there | Knocked out? | Lit inside, before → after |
  |---|---|---|---|
  | `fill="#fff"` (control) | white | yes | 7,644 → 0 mm (correct) |
  | `fill="#fff" fill-opacity="0.3"` | `#4d4d4d` grey | yes | 7,644 → **0** |
  | `<g opacity="0.2">` white | `#333` | yes | 7,644 → **0** |
  | `fill="rgba(255,255,255,0.25)"` | `#404040` | yes | 7,644 → **0** |
  | CSS class `fill:#fff; fill-opacity:.15` | `#262626`, near black | yes | 7,644 → **0** |
  | radial gradient white → `#0040ff` | blue shading | yes | 7,644 → **0** |
  | **Logo:** gradient emblem (white centre, blue edge) beside a black bar, nothing overlapping | a blue emblem | the emblem is removed | emblem box 2,376 → **0**; whole job 5,293 → 2,160 mm |
  | `mask` showing only the left half of the white rectangle | right half black | yes | right half 3,354 → **0** |

  Every case gets the toast "probe.svg: 1 white shape will not burn, as in the file: it was cut out of the shapes under it. To burn the white too, Undo: it returns on its own operation."
  - The gradient and mask cases also get their existing notes: "painted with a gradient in one solid colour…" and "…areas the masks hide are included". The knock-out does the opposite of the mask note: it removes those areas.
  - The opacity cases get no note at all.
- **Evidence:** REPRO (`zz-v7\mut\src\zz-v7\knockout-probe.test.ts`, output `zz-v7\knockout.json`).
- **Severity:** P2, with a point for the refuter and coordinator.
  - **Why the output is wrong.** Output that was ink in the file is left unburned: a hole where the design is dark grey, or a whole blue emblem missing.
  - **Why P2.** A warning toast does reach the operator before output. It names a white shape that "will not burn", and Undo restores it. The canvas also shows the hole, because the knocked geometry is what it draws.
  - **The point to weigh (P1).** The toast misstates the cause ("as in the file"). An operator whose emblem is blue does not recognise it as "a white shape". By METHOD §3, only a clear warning about the specific mismatch lowers a P1, and this one is not clear.
- **Novelty:** new. ADR-686 does not consider opacity, gradients or masks. U3's fixtures were all opaque.
- **Fix direction:**
  - Treat only opaque white as paper: effective fill alpha 1, no gradient server, no mask.
  - Carry the composed fill alpha and the paint server onto the parsed entry, so the knock-out can refuse those shapes. Leave them as they were before ADR-686, and name them in the import notes.
- **Refuter:** PENDING.

### V7-P2-2 — Re-importing an unchanged SVG whose white shapes were knocked out resets the knocked parts' operations to defaults; the operator's power, passes and recipe are discarded

- **Where:**
  - `src/ui/state/svg-fragment-mutation.ts:107`: `matchSvgSourceComponents(previous, fragment.objects)` compares the scene's components with the re-parsed fragment.
  - `src/ui/state/svg-fragment-reimport.ts:11-45`: the content key includes every path's polylines.
  - A knocked component was rewritten by the import (white path removed, dark path replaced by its even-odd difference), so it never matches its own unchanged source. It falls to `createArtworkOperations` (`svg-fragment-mutation.ts:217`) with fresh defaults, and `pruneOrphanLayers` deletes the old operation.
  - `src/ui/state/object-insert-actions.ts:346-362`: the knock-out then runs again.
- **Anchor:**
  - **Contract, ADR-358 Decision 6** (`docs/decisions/ADR-358-composed-svg-image-round-trip.md:40-43`): "Unambiguous unchanged source content retains component identities and path-specific operation settings".
  - **Twin:** the same logo with a green diamond instead of white keeps its settings.
- **Scenario:**
  1. A beginner imports a logo with a white detail on main. The knock-out runs, as ADR-686 intends.
  2. They tune the operation to their material (77 %, 3 passes).
  3. They edit something else in the SVG, or nothing, and press **Re-import**.
  4. The logo's operation is replaced by a new one at the starter values. The next Start burns at 30 %, 1 pass.
- **Evidence:** REPRO (`knockout-probe.test.ts`, test "re-import keeps operation settings"; output `zz-v7\reimport.json`):
  - **White logo.** Before: `["probe 1:77/3"]`. Outcome: `{kind:"replaced", kept:0, added:1, removed:1, whiteKnockout:{whiteShapes:1}}`. After: `["probe 1 2:30/1"]`.
  - **Control (green diamond).** Outcome: `kept:1, added:0, removed:0`. After: `["probe 1:77/3","probe 2:77/3"]`.
  - **The toast**, read from `describeReimportOutcome`: "Re-imported probe.svg — new layer settings (1 new, 1 removed)", then the white-shape notice.
  - **Design Studio** commits through the same `reimportSvgFragment` (`src/ui/artcraft-studio/apply-studio-snapshot.ts:80-81`). That route was checked by READ only.
- **Severity:** P2. The power and passes change against the operator's settings, but the operator is told:
  - the toast says "new layer settings";
  - with the starter defaults, Job Review lists "still using the uncalibrated defaults" as a beginner note.
  It is wrong behaviour an ordinary Re-import user hits, with a terse message. A logo imported on 1.0.29 is not affected: its components still match before the knock-out runs.
- **Novelty:** new. The ADR-686 tests cover Re-import only through Decision 1's list. No test re-imports a knocked import.
- **Fix direction:** match on the source content as parsed, not the knocked result. For example, store a source-content key on each fragment component at import, before the knock-out, and compare re-parsed fragments against it. Add a test that re-imports an unchanged white logo and keeps 77 %/3.
- **Refuter:** PENDING.

### V7-P2-3 — The cut-last warning compares whole operations: two coasters, or one coaster plus any engraving elsewhere on the same operation, get no warning, though each part is cut free before its engraving

- **Where:** `src/core/cut-before-engraving.ts:62-75`. `cutsHolding` takes `computeJobBounds({ groups: [group] })`, the bounds of the whole compiled engraving group (one per operation), and requires that box inside one cut ring (`:100-114`).
- **Anchor:**
  - **Contract, ADR-480 Amendment 2 Context and Decision 1** (`docs/decisions/ADR-480-amendment-2-a-cut-before-the-engraving-inside-it-is-warned.md:10-13, 25-29`). The warning exists because "the cut-free part can drop or shift before it is engraved". Its Consequences (`:59-62`) name only the concave-outline exception.
  - **Twin:** one coaster against the same coaster duplicated. Both burn every cut before every engraving.
- **Scenario:** a beginner makes the U3 coaster (Line 100 %, 300 mm/min, drawn first; Fill name inside) and duplicates it to cut two. The compiled job is `cut:cut, fill:fill`: both coasters are cut free, then both names engrave. Job Review and Save G-code say nothing.
- **Evidence:** REPRO (`zz-v7\mut\src\zz-v7\cutlast-probe.test.ts`, output `zz-v7\cutlast.json`, `cutsBeforeEngraving` and `cutOrderWarnings` on `compileJob`):

  | Case | Groups | Warned |
  |---|---|---|
  | One coaster, name inside | cut, fill | yes |
  | Two coasters on one cut operation, a name in each | cut, fill | **no** |
  | Two coasters, created coaster-name-coaster-name | cut, fill | **no** |
  | 2 × 2 grid of coasters | cut, fill | **no** |
  | One coaster plus a label elsewhere on the same Fill operation | cut, fill | **no** |
  | Two coasters after Cut last | fill, cut | no (correct) |

- **Severity:** P2, as U3-P2-4: G-code as set, guidance missing. The fix covers its single-part repro but misses the next ordinary step, making more than one.
- **Novelty:** new. The PR's tests use one outline and one engraving.
- **Fix direction:** test each engraving segment, or connected run of segments, against the earlier cut rings rather than the group's box. For example, take the segments whose own box and centre fall inside a ring, and flag when any exist. Keep the strength rule.
- **Refuter:** PENDING.

### V7-P3-1 — "Before you start" is shown only in Job Review; four other routes that fire the laser show no safety words

- **Where:** the block renders only in `src/ui/laser/job-review/JobReviewDialog.tsx:94` and the remote prompt (`before-you-start.ts:38-48`). `grep` for its text finds no other site. These routes start a burn without Job Review:
  - **G-code Inspector Run** of an external file (`src/ui/gcode-inspector/external-run.ts:217-250`). With laser mode verified, `confirmLaserModeStartEvidence` asks nothing, so there is no dialog at all.
  - **Laser recovery resume** (`src/ui/laser/laser-recovery-flow.ts:108-117`).
  - **Start from line** (`src/ui/laser/start-job-resume-stream.ts:181-188`).
  - **Camera calibration target engrave** (`src/ui/camera/calibrate/transient-camera-job.ts:89`, "Engrave the target?").
- **Anchor:**
  - **Contract, ADR-689 Decision 1** covers "Every laser and CNC Job Review for a Start", so these routes are outside its letter.
  - **U4-P2-1's anchor** was "Nothing on the burn path…". L9 entry-point parity applies.
- **Scenario:** a LightBurn user who runs saved `.gcode` files through the Inspector, or a beginner whose first job is the camera target, never sees glasses, fire or supervision before the laser fires.
- **Evidence:** READ (the four call sites above; `grep -rln "BEFORE_YOU_START|beforeYouStart"` in `src` finds only Job Review, the tutorials and the remote projection).
- **Severity:** P3. U4-P2-1's main path (Start, Ctrl+K Start, Run again, second pass, phone/MCP) is fixed. These are secondary routes, and the risk is behavioural, as U4-P2-1's refuter ruled.
- **Novelty:** new. #1609 and #1610 do not touch these routes.
- **Fix direction:** prepend `beforeYouStartText(machineKind)` to the resume, Start-from-line and camera-target confirms. Give the Inspector Run a one-line safety confirm, or its own "Before you start" line, when no other confirm is shown.
- **Refuter:** PENDING.

### V7-P3-2 — In a browser without file pickers, the banner promises autosave unconditionally, and the autosave-failure toast says "Save the .lf2 file manually", which that browser cannot do

- **Where:**
  - `src/ui/app/BrowserFilesNotice.tsx:24-26`: "…your work is autosaved in this browser."
  - `src/ui/app/use-autosave.ts:41-42` and `:59-71`: `AUTOSAVE_FAILURE_MESSAGE` is used whether or not pickers exist.
- **Anchor:** **Twin**: ADR-688 Decision 5, "No dead Save", against the autosave-failure toast's advice. Also ADR-688 Decision 4, whose banner text is only true while browser storage persists.
- **Scenario:** a Firefox or Safari user whose site data is blocked, or whose project exceeds the storage quota, sees the banner say work is autosaved, then "Autosave could not preserve the newest project. Save the .lf2 file manually…". There is no Save. Closing the tab loses the work.
  - In a private window, the autosave lasts only until the window closes. That is a ground-truth claim: UNVERIFIED, not fetched in this audit.
- **Evidence:** READ.
- **Severity:** P3. The browser is unsupported by design (PROJECT.md, ADR-688 keeps no second persistence path), so the loss is accepted. The defect is two messages that contradict the app's own no-Save state.
- **Novelty:** new (ADR-688 wording).
- **Fix direction:**
  - When `platformCanPickFiles` is false, the failure toast should say: "This browser can't keep this project. Open KerfDesk in Chrome or Edge, or the desktop app."
  - The banner should say "autosaved in this browser while its storage is available". Drop that clause in a private window, if it can be detected.
- **Refuter:** PENDING.

### V7-P3-3 — The "Before you start" fold is keyed by profile id, so every machine on the generic starter or one listed model shares one fold; ADR-689's "a newly set-up one shows it open" is false for an unlisted machine

- **Where:**
  - `src/ui/laser/job-review/JobReviewBeforeYouStart.tsx:18`: the key is `profileId ?? name`.
  - `src/ui/laser/job-review/before-you-start.ts:52-58`.
  - The generic starter's id is `'generic-grbl-400x400'` (`src/core/devices/device-profile.ts:409-411`). "My machine isn't listed" keeps it (ADR-687 Context, `docs/decisions/ADR-687-a-beginners-notes-come-first.md:19-21`).
- **Anchor:** **Contract, ADR-689 Decision 2** (`docs/decisions/ADR-689-job-review-says-before-you-start.md:45-49`): "a machine never folded, such as a newly set-up one, shows it open".
- **Scenario:** someone folds the block on the starter profile, then sets up their own unlisted machine. The new machine's first Job Review shows the block folded. Only the heading "Before you start" remains visible.
- **Evidence:** READ.
- **Severity:** P3. The ADR drifts from the code, and the heading never disappears.
- **Novelty:** new.
- **Fix direction:** key the fold by the machine's own identity (saved machine id or name) rather than the catalogue profile id, or correct the ADR.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"Knock-out loses a dark shape painted over the white."** The four-level nest (black r18 > white r14 > black r10 > white r5) burns 6,370 mm, which matches the two black rings (4,021 + 2,356 mm at 0.1 mm). The centre burns 0. Correct.
- **"Knock-out ignores `<use>`, transforms, clip paths, `currentColor`, `hsl()` or CSS classes."** All knock out correctly. The rotated 10 mm white square takes 1,000 mm out of 16,000. The clipped white disc takes 785 mm out, and the corners outside the clip still burn.
- **"Restore can overwrite a newer saved .lf2."** `setProject` resets `lastSaveTarget` to null (`src/ui/state/store-initial-project-state.ts:38`, not retained by `retainedApplicationState`, `project-actions.ts:277-301`). Restored work saves through Save As only.
- **"A same-tab reload's declined card is overwritten by the reloaded tab's first autosave."** `claimSession` rotates to a fresh session id when the inherited slot holds a snapshot (`autosave-durable.ts:348-360`). The old slot becomes a separate, listable session.
- **"Beginner notes push a real warning out of Job Review."** Job Review lists every beginner note and warning, and folds only the technical ones (`JobReviewWarnings.tsx:58-75`). The power-scale notes it folds are informational: output follows the connected `$30`. Save G-code's three-toast order is ADR-687 Decision 3, as decided.
- **"The cut-last check runs on CNC."** It is skipped (`job-intent-warnings.ts:64-66`). `orderGroupsIntoToolSections` always puts clearing before profiles (`src/core/cnc/cnc-tool-sections.ts:14-19`), as ADR-480 Amd 2 Decision 4 says.

## Verified clean

**#1556 (ADR-686):**
- The U3 repro is fixed. The U3 fixtures (`fill="#fff"`, `white`, style plus class, white letters, the auditor's logo) burn 0 inside the white shapes, and the even-odd control matches within 0.5 % (the PR's integration test, run on main: pass).
- My own pure-white case goes from 7,644 mm to 0 inside.
- The knock-out is a single undoable step: the undo depth is 2 with white, against 1 without, and redo restores the knocked state.
- Siblings that work: a white background painted first is removed and cuts nothing; a white shape in a later entry, after a stroke, knocks across objects and removes its white-only part and operation; `currentColor`, `hsl`, `<use>`/`<symbol>`, transforms and `clip-path` all behave.
- Near-white `#fefefe` and white strokes are unchanged, as the ADR's "Not covered" list says.
- A shape with a white fill and a black stroke imports as the black line (pre-existing, disclosed).
- Every routing that commits a fragment runs the knock-out: file, drag and drop, Remote `design-imports.ts:62`, and Studio. PDF/AI pages and the Library do not; PDF is listed in the ADR, and the Library holds KerfDesk's own assets.
- "White engrave on dark material" with a dark backdrop rectangle: the backdrop burns with holes. ADR-686 Decision 2 covers only all-white designs. The notice and one Undo reach the operator, so this is the decided trade-off.
- Raster images in an import are never knocked.
- **Test truth:** the integration test imports `applyImportWhiteKnockout`, added by the PR, and asserts `whiteKnockout`, so it cannot pass before the fix.

**#1561 (ADR-480 Amd 2, ADR-687):**
- The U3-P2-4 coaster is warned, and Cut last clears the warning.
- An open outline, a tabbed cut, cut output off and a light score at 10 %/3000 are not warned.
- An engraving straddling the cut is not warned. An engraving inside a cut hole (the slug) is warned, which is correct.
- Two equal-strength cuts (outer, then an inner hole) are not warned, by the ADR's own measure.
- A 30 %/1000 border before a 30 %/1500 Fill is called a cut, by the same measure (stronger). That is an advisory nag, and Cut last fixes it harmlessly.
- The warning never gates Start.
- U4-P2-6: the Job Review ranking lists beginner notes, then warnings, then folded technical notes, and the count covers only shown items.
- The CutLast button is hidden for a frozen second pass.
- Test truth: the new modules (`cut-before-engraving.ts`, `review-note-rank.ts`) did not exist before the PR.

**#1566 (ADR-689):**
- The block renders for purpose `start` and `laser-second-pass` and not for `frame` (`JobReviewDialog.tsx:94`).
- Ctrl+K "Start job" and Run again go through `runStartJobFlow` → `reviewFramedRunForStart` → Job Review.
- Phone and MCP get the text in `acknowledgement.prompt` (`machine-projections.ts:279`; `machine-review.test.ts` passes).
- It is wording only: it is not in the Start authorization, and it is not shown while running, so Abort, Pause and status are untouched.
- Folding is per profile and the heading stays visible (but see V7-P3-3).
- Focus hint and Learn step present.

**#1564 (ADR-688):**
- **The U1-P2-3 repro is fixed.** The startup card offers the newest work. Start fresh and editing both leave the slot. A first design stays listed after a later session's work (`autosave-recent-sessions.test.ts` passes on main). This window's own slot and live windows' slots are not listed.
- **Restore asks first.** File > Recover goes through Save / Don't Save / Cancel. Restore is refused while a job runs, and re-homes before clearing (M15).
- **Multiple windows.**
  - A live window's slot is never listed.
  - A slot whose lock probe is unsupported is listed, but its clear is `retained`, so a restore duplicates it rather than deleting another window's work.
  - Two windows restoring the same slot each get a copy.
- **No-picker browsers (U1-P2-1).** The banner shows when either picker is missing. The Save choice is removed from the discard question (`browser-without-file-pickers.test.tsx` passes).
- **Focused suites.** The 14 suites of the four PRs (99 tests) pass on main (`zz-v7\mut`, one run).

## Not verified

- **e2e and rendering.** The available memory was 2.29–2.49 GB all session, under the 3 GB gate, so no e2e spec and no browser rendering. That covers:
  - the related e2e specs (`autosave-session-ownership.e2e.ts`, `autosave-version-preservation.e2e.ts`, `large-heightfield-autosave.e2e.ts`, `settings-sync-deep-audit.spec.ts`, `workbench.e2e.ts`, `controller-recovery-toast.spec.ts`);
  - the rendered card, dialog rows, toasts and Job Review block.
  V7-P1-1's UI half is READ.
- **Cut last after Frame.** Whether Cut last, pressed in a Job Review opened after Frame, rebinds the framed permit or asks for a new Frame. `rebindReviewedFramedRun` was read, not run.
- **Desktop.** Electron recovery ("on this computer") and file association at launch: not run.
- **Private-window storage lifetime** in Firefox and Safari (V7-P3-2): not fetched.
- **Design Studio** apply over a knocked import (V7-P2-2 sibling): READ only.
- **1.0.29 Re-import.** Not run on `old29`. The green-diamond control and the code path show the difference instead.
- **Hardware:** none, by instruction.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v7\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `mut\` | `git archive 5f09e1110` (src, e2e, public, scripts, configs) with a `node_modules` junction (remove the junction with `cmd /c rmdir` before deleting) and `vite.zz.config.ts` (fflate alias) |
| `mut\src\zz-v7\knockout-probe.test.ts` → `knockout.json`, `reimport.json` | V7-P2-1 (20 SVG cases) and V7-P2-2 |
| `mut\src\zz-v7\cutlast-probe.test.ts` → `cutlast.json` | V7-P2-3 and the cut-last siblings |
| `mut\src\zz-v7\recover-probe.test.ts` → `recover.json` | V7-P1-1 (run with `NODE_OPTIONS=--no-experimental-webstorage`) |

Command: `node node_modules/vitest/vitest.mjs run src/zz-v7/<file> --maxWorkers=1` from `mut`.

```json
{
  "area": "V7",
  "id": "fix-design-burn-safety",
  "tree": "5f09e1110",
  "raised": 7,
  "findings": [
    {"id": "V7-P1-1", "severity": "P1", "area": "V7", "file": "src/ui/state/autosave-durable-read.ts", "line": 88, "anchor": "Contract ADR-688 D3 (slots, removal only by Restore/Don't Save); twin readLatest", "evidence": "REPRO (service + fake IndexedDB) + READ (dialog)", "verdict": "PENDING", "known": false, "summary": "One closed session's 30 s IndexedDB copy and newer beforeunload localStorage copy share a storage key and are listed as two rows in File > Recover unsaved work; restoring the older row clears the key and permanently deletes the newer edits (up to a whole job's worth when edited during a burn)"},
    {"id": "V7-P2-1", "severity": "P2", "area": "V7", "file": "src/core/geometry/white-fill-knockout.ts", "line": 128, "anchor": "Contract ADR-686 D1 'painted pure white'; twin SVG alpha compositing", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "fill-opacity/opacity/rgba white, white-first gradients and masked white are knocked out as paper: a dark-grey highlight becomes a hole, a blue gradient emblem vanishes; toast says 'as in the file'. Refuter may weigh P1"},
    {"id": "V7-P2-2", "severity": "P2", "area": "V7", "file": "src/ui/state/svg-fragment-mutation.ts", "line": 107, "anchor": "Contract ADR-358 D6 (unchanged source keeps operation settings); twin non-white logo", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Re-import of an unchanged logo whose white was knocked out never matches its components, so tuned operations (77%/3 passes) are replaced by defaults (30%/1); toast 'new layer settings'"},
    {"id": "V7-P2-3", "severity": "P2", "area": "V7", "file": "src/core/cut-before-engraving.ts", "line": 67, "anchor": "Contract ADR-480 Amd 2 Context/D1; twin one coaster vs two", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Cut-last check uses the whole engraving operation's box: two coasters, a grid, or one coaster plus a label elsewhere on the same Fill operation get no warning"},
    {"id": "V7-P3-1", "severity": "P3", "area": "V7", "file": "src/ui/gcode-inspector/external-run.ts", "line": 217, "anchor": "L9 parity with ADR-689 D1 / U4-P2-1", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Before you start appears only in Job Review/remote; Inspector Run, laser recovery resume, Start from line and the camera target engrave fire the laser with no safety words"},
    {"id": "V7-P3-2", "severity": "P3", "area": "V7", "file": "src/ui/app/BrowserFilesNotice.tsx", "line": 24, "anchor": "Twin ADR-688 D5 'No dead Save' vs AUTOSAVE_FAILURE_MESSAGE", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "No-picker browser: banner promises autosave unconditionally, autosave-failure toast says 'Save the .lf2 file manually' which that browser cannot do"},
    {"id": "V7-P3-3", "severity": "P3", "area": "V7", "file": "src/ui/laser/job-review/JobReviewBeforeYouStart.tsx", "line": 18, "anchor": "Contract ADR-689 D2", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Fold keyed by catalogue profile id: the generic starter and every unlisted machine share one fold, so a newly set-up unlisted machine can open folded"}
  ]
}
```

## Refuter (2026-11-08)

- **Tree:** main `5f09e1110`. Reads in `j10-main`; checked byte-identical to my own `git archive 5f09e1110` export `scratchpad\zz-v7r\mut` for every cited file. Vitest runs there (`node node_modules/vitest/vitest.mjs run src/zz-v7r/<file> --maxWorkers=1`, `NODE_OPTIONS=--no-experimental-webstorage`). The auditor's probes were not reused; mine are new.
- **Memory:** 2.0–2.4 GB available all session. Vitest gate met; browser gate (3 GB) never met, so no e2e and no real-browser run.
- **Verdicts:** 7 raised, 0 refuted, 7 confirmed at the auditor's severity.

### V7-P1-1: CONFIRMED P1 (REPRO, real modules)

What would make it false: the unload copy uses a different key; or the IndexedDB commit retires the local copy; or the read merges one key's copies; or the clear removes the local copy only when it matches the restored snapshot; or a session's lock keeps the old slot from being cleared. None holds.

- **Same key.** The unload write is `writeAutosave(snap.project)` with no scope (`src/ui/app/use-autosave.ts:110`), so its key comes from `currentAutosaveSessionId()` (`src/ui/state/autosave-local-storage.ts:61-62`). The interval write uses `autosaveStorageKeyForSession(session.sessionId)` (`src/ui/state/autosave-durable.ts:250`). My probe constructs the service with no `initialSessionId` or `rotateSessionId` override, so both ids come from `sessionStorage` exactly as in the app. Both writes landed under the same key, `lf2:autosave:v1:e5c578a8-…`.
- **Nothing merges.** The read pushes the local copies, then every IndexedDB slot (`src/ui/state/autosave-durable-read.ts:88-107`), and only sorts them (`:67`). The IndexedDB modules never touch `localStorage`; I grepped them.
- **The clear is unconditional.** `clearSnapshotNow` calls `clearAutosave(snapshot)` (`autosave-durable.ts:314`). That reaches `localStorage.removeItem(storageKey)` (`autosave-local-storage.ts:143`) with no check of `savedAt` or content.
- **Locks.** I used a shared in-memory Web Locks manager, because Chrome, Edge, Firefox and Safari all have `navigator.locks`. The closed tab's lock is released, so its copies probe as `abandoned` and the clear runs under `runIfAbandoned` (`autosave-durable.ts:169-172`).
  - The upstream `autosave-recent-sessions.test.ts` passes `null` locks. With `null` locks a foreign clear is `retained`, and the loss would not show.
- **Repro** (`zz-v7r\mut\src\zz-v7r\recover-refute.test.ts` → `zz-v7r\recover-refute.json`):
  - **Session A:** an interval write at t=1000 (IndexedDB), then the unload write at t=1020 (local, same key), then the tab closes.
  - **Session B, a new tab** (`sessionStorage` cleared):
    - `readLatest` returns the unload copy.
    - `readRecent` returns two rows with one `storageKey`, both `ownership: "abandoned"`: local at 1020 and IndexedDB at 1000.
    - I ran `restoreAutosaveSnapshot(indexeddbRow, service)`, the function File > Recover calls (`restore-unsaved-work.ts:36`). It returned `true`. The screen shows the older copy, and `localStorage` has no keys left.
  - **Session C:** the only row is "interval copy (older)", re-homed into B's key. A's IndexedDB slot is cleared (`current: null`). The newer edits are gone from every store.
  - **Control 1:** restoring the newer (local) row leaves "unload copy (newest edits)", so nothing is lost.
  - **Control 2:** when the interval itself fell back to localStorage, there is one row: the unload write overwrites the same key in the same backend. So the duplicate needs IndexedDB working, which is the normal state.
- **UI** (REPRO in jsdom, `recover-dialog.test.tsx` → `recover-dialog.json`). Two snapshots with one `storageKey` render as two `li[data-unsaved-work="lf2:autosave:v1:session-a"]` rows: "3 objects · Autosaved … (3 minutes ago)" and "2 objects · Autosaved … (24 minutes ago)".
  - **Challenge to the auditor's wording.** The rows *can* be told apart: each has its own time, object count and thumbnail (`UnsavedWorkDialog.tsx:110-125`).
  - What nothing says is that they are two copies of one session, and that restoring one deletes the other. The intro text promises the opposite (`:62-63`, "Work from earlier sessions"), and so does ADR-688 Decision 3: slots are removed only by Restore of that slot, Don't Save, or unreadable retirement.
- **Severity.** P1 stays. METHOD §3 "loses … user data" has no reach clause.
  - **Is the loss real?** Yes. The older row is a legitimate choice, for example a user who wants the earlier layout and expects the other row to stay listed. The newer content is unrecoverable afterwards.
  - **Is there a warning?** No. The Save / Don't Save / Cancel question concerns the open document, and the only message afterwards is "Restored unsaved work".
  - The loss is bounded below by the edits since the last 30-second write. It grows to a whole job when the user edited while streaming, because the interval skips while streaming (`src/ui/state/autosave-loop.ts:96`).
- **1.0.29.** The bug is not there. `zz-v2\old29` has no `readRecent` or Recover dialog. Its card and its status-bar "Recover autosave" (`AutosaveRecoveryControl.tsx`) both go through `readLatest`, which always takes the newest copy, and whose restore or discard clears both copies harmlessly. The same duplicate candidates existed there, but only the newest was reachable. **New with #1564.**
- **Not verified:** a real-browser run (edit → close the tab → reopen → File > Recover), under the memory gate; and the Electron close path.

### V7-P2-1: CONFIRMED P2 (P1 weighed and rejected; REPRO)

- **Cause, by READ.** `isWhite` compares the colour only (`src/core/geometry/white-fill-knockout.ts:128-130`). The parser maps any white with alpha above 0 to `#ffffff` (`src/io/svg/svg-paint.ts:82`) and drops a fill only at `fill-opacity <= 0` (`src/io/svg/parse-svg.ts:256`). A gradient paints as its first visible stop (`svg-paint-server.ts:81-88`).
- **Repro** (`knockout-refute.test.ts` → `knockout-refute.json`; store `importSvgFragment`, then `compileJob`; lit mm for the whole job, knocked → after one Undo):

  | Case | `whiteKnockout` | Lit, knocked → undone |
  |---|---|---|
  | `fill="#fff"` (control) | 1 | 10,957 → 14,963 |
  | `fill-opacity="0.15"` white | 1 | 10,957 → 14,963 (identical to pure white) |
  | `<g opacity="0.2">` white | 1 | 10,957 → 14,963 |
  | `rgba(255,255,255,0.25)` | 1 | 10,957 → 14,963 |
  | radial gradient white → `#0040ff`, beside a black bar, no overlap | 1 | 2,240 → 5,373 (the emblem is gone) |
  | the same gradient, blue first (control) | none | 5,373, unchanged |
  | white rect masked to its left half, over black | 1 | 8,960 → 16,960 |

- **Toast.** It is the same in every knocked case: "probe.svg: 1 white shape will not burn, as in the file: it was cut out of the shapes under it. To burn the white too, Undo: it returns on its own operation."
  - In the gradient-emblem case nothing lay under the shape, and the toast still says it was "cut out of the shapes under it".
  - The gradient and mask cases also carry their parser notes. The opacity cases carry none.
- **Undo.** One Undo restores every case: the white path is back (`["#000000","#ffffff"]`) and the lit length matches the as-parsed import. A second Undo empties the scene.
- **Canvas.** READ only, not rendered. The canvas draws the scene's paths, and the knocked state is the scene, so the hole, or the missing emblem, is visible before Start.
- **Why not P1.** METHOD lets a P1 be lowered only by a clear warning of the specific mismatch before output. This one qualifies:
  - A `warning` toast (8 s, `toast-store.ts:22`) states the effect, that a shape will not burn, and the one-step remedy.
  - The canvas shows the result.
  - For the gradient, the parser note explains why the shape counts as white ("painted … in one solid colour, the gradient's first visible stop").
  - Its stated *cause* ("as in the file") is wrong for translucent, gradient and masked whites. That makes the message misleading, which is the P2 definition, not silent.
  - This differs from V2-P2-1, which had no message at all. The coordinator may still escalate it on the gradient-emblem case, where an operator may not map "white shape" to a blue emblem.

### V7-P2-2: CONFIRMED P2 (REPRO)

- **Repro** (`knockout-refute.test.ts`, "re-import"). Import, set every operation to 77 % / 3 passes, then Re-import the *unchanged* SVG through the store's `reimportSvgFragment`:
  - **White-circle logo.** Before `["probe 1:77/3"]`; outcome `replaced, kept 0, added 1, removed 1, whiteKnockout {whiteShapes:1}`; after `["probe 1 2:30/1"]`.
  - **Green-circle twin.** `kept 1, added 0, removed 0`; after `["probe 1:77/3","probe 2:77/3"]`.
- **Cause.** Matching runs on the knocked scene against the re-parsed source (`src/ui/state/svg-fragment-mutation.ts:107`). The knocked component never matches, so it falls to `createArtworkOperations` (`:217`), and the knock-out runs again afterwards (`src/ui/state/object-insert-actions.ts:351`).
- **Anchor.** Confirmed against ADR-358 Decision 6 at `docs/decisions/ADR-358-composed-svg-image-round-trip.md:40-43`. ADR-686 Decision 1 names Re-import as a knock-out route but says nothing about settings, so D6 governs.
- **Why not P1.** The power change is not silent. The Re-import toast says "new layer settings (1 new, 1 removed)" (`src/ui/app/import-toasts.ts:106`) before any output, and one Undo returns the tuned operation.
  - It is a `success` toast (`:109`), which weakens it. That is a point for the fix, not a reason to escalate.

### V7-P2-3: CONFIRMED P2 (REPRO)

- **Repro** (`cutlast-refute.test.ts` → `cutlast-refute.json`; 80 mm square on Line 100 %/300 at the cut, 20 mm square on Fill inside; `compileJob` + `cutsBeforeEngraving`):

  | Case | Groups | Warned |
  |---|---|---|
  | One coaster | cut, fill | yes |
  | Two coasters side by side | cut, fill | no |
  | Two coasters, objects in coaster-name-coaster-name order | cut, fill | no |
  | 2 × 2 grid | cut, fill | no |
  | One coaster plus a label outside it on the same Fill | cut, fill | no |
  | Two coasters after Sort cuts last | fill, cut | no (correct) |
  | Two coasters inside one big outer cut | cut, fill | yes (only because the big ring holds the whole Fill box) |

- **Cause.** The whole Fill group's box must sit inside one ring (`src/core/cut-before-engraving.ts:67-73`, `:100-113`). The G-code burns every cut before every name, so the missed warning returns these users to U3-P2-4's harm: a part cut free before its engraving.
- **Severity.** P2, by U3-P2-4's own rating (U3 refuter: "CONFIRMED P2"). The G-code is what Run order says, and only the guidance is missing.

### V7-P3-1: CONFIRMED P3 (READ)

- The block's text exists only in `before-you-start.ts`, `JobReviewBeforeYouStart.tsx`, the remote types and the tutorials (grep in `src`, tests excluded).
- The four routes confirm only with `confirmLaserModeStartEvidence` and their own prompts:
  - `src/ui/gcode-inspector/external-run.ts:217-250`;
  - `src/ui/laser/laser-recovery-flow.ts:108-117`;
  - `src/ui/laser/start-job-resume-stream.ts:171-188`;
  - `src/ui/camera/calibrate/transient-camera-job.ts:86-97`.
- ADR-689 Decision 1 is scoped to Job Review, so these routes fall outside it, under L9 parity. P3, as U4-P2-1's refuter ruled the risk behavioural.

### V7-P3-2: CONFIRMED P3 (READ)

- The banner says the work "is autosaved in this browser" with no condition (`src/ui/app/BrowserFilesNotice.tsx:24-26`).
- `AUTOSAVE_FAILURE_MESSAGE` (`src/ui/app/use-autosave.ts:41-42`, used at `:67` and `:215`) says "Save the .lf2 file manually". The web adapter has no download fallback: `pickFileForSave` throws without `showSaveFilePicker` (`src/platform/web/web-adapter.ts:83-84`).
- The ground-truth claim about private-window lifetime stays UNVERIFIED (not fetched).

### V7-P3-3: CONFIRMED P3 (READ)

- The fold key is `profileId ?? name` (`src/ui/laser/job-review/JobReviewBeforeYouStart.tsx:18`).
- The starter's id is `generic-grbl-400x400` (`src/core/devices/device-profile.ts:410`). ADR-687's Context (`:19-20`) says "My machine isn't listed" saves on that id.
- ADR-689 Decision 2 (`:45-49`) promises that a newly set-up machine shows the block open. The code breaks that promise for an unlisted machine set up after the starter's block was folded. The heading stays visible, so this is P3.

### New findings

None. Two candidates were checked and dropped:
- **Duplicate rows with identical content** (no edits after the last interval write). Same root cause as V7-P1-1, and harmless on its own.
- **Knock-out Undo is incomplete.** It is not: one Undo restores every case above.

### Challenges

- **To V7-P1-1's wording.** The rows are not indistinguishable: time, object count and thumbnail differ. What the user cannot tell is that two rows are one session, and that a Restore deletes the other row.
- **To the auditor's repro method.** A repro with `null` locks would not show the loss, because the foreign clear is `retained`. The finding depends on Web Locks being present, which is every supported browser, so it stands.
- **For the coordinator.** V7-P2-1 has the strongest P1 case, the white-first gradient emblem that vanishes. I kept it at P2 on the toast plus canvas plus Undo.

### Not verified (refuter)

- A real-browser run of V7-P1-1, and any e2e. Available memory was 2.0–2.4 GB, under the 3 GB gate.
- The Electron close path for the unload copy.
- Canvas rendering of the knocked import. READ only.
- Firefox and Safari private-window storage lifetime.

### Repro files

All under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v7r\`:
- `mut\` is my `git archive 5f09e1110` export, with a `node_modules` junction. Remove the junction with `cmd /c rmdir` before deleting the folder.
- Probes in `mut\src\zz-v7r\`: `recover-refute.test.ts`, `recover-dialog.test.tsx`, `knockout-refute.test.ts`, `cutlast-refute.test.ts`.
- Outputs: `recover-refute.json`, `recover-dialog.json`, `knockout-refute.json`, `cutlast-refute.json`.

Refuter counts: raised 7, refuted 0, P1 1, P2 3, P3 3, known 2
