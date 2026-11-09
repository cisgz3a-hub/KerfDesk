# Rolling audit v12 — X2 Returning user

- **When:** 2026-11-09, 13:40–15:10 +0800   **Tree:** origin/main @ `af1573c77`. Repros ran in the scratchpad tree `j14-main`; 8 changed files were spot-checked equal to `af1573c77` with `git hash-object`.
  - Older code: v10's export of `df2279e26` (1.0.29, schema 21) in `scratchpad\zz-v2\old29`, used read-only, through v10's `old29` bundle.
  - Saved inputs: the 22 golden files in `src/__fixtures__/returning-user/`, v10's 1.0.29 scenes (`zz-v2\out\b-saved`, `zz-v2r\out\g29`, the refuter's star and ring), and new scenes saved by 1.0.29's own store in `zz-x2\out\`: logos, copies, reliefs and CSS-transform SVGs.
- **Scope:** projects, autosaves and last-machine documents written by 1.0.29, opened on main through the real loader and store (`deserializeProject`, `completeNativeProjectOpen`, `setProject`), then compiled with `prepareOutputSnapshot` + `emitPreparedGcode` on both builds and diffed.
  - PRs: #1617, #1618, #1619, #1622, #1635, and the burn identity of #1601, #1602, #1603 and #1606–#1608. The other code PRs since v10's tree (`5f09e1110`) were #1592, #1597, #1605, #1609, #1611, #1612, #1614–#1616, #1620 and #1628; they are covered by the byte comparison only.
  - Governing ADRs: ADR-686 Amd 1–3, ADR-637 Amd 8, ADR-688 Amd 1, ADR-580 Amd 2 and ADR-574 Amd 1.
- **Lenses run:**
  - **L11:** open, compile both and diff; re-save; open toasts.
  - **L9:** routes File > Open, autosave restore, Recover unsaved work, Re-import, Leave white unburned, Machine Setup restore, Job Review and the CNC recovery wizards.
  - **L1:** each ADR above.
  - Not run: L2, L5, L12. Other areas own them (X1, X3, X6, X7). No hardware.
- **Counts:** 6 raised → refuter pending → P1 2 / P2 1 / P3 3 (+ 1 KNOWN, V2-P3-1, still open).

## Headline

**Opening a 1.0.29 project on main still changes no burn, except height-map reliefs.** Across 22 golden files and 27 of v10's 1.0.29 scenes, 224 G-code pairs were compiled:
- 212 are byte-identical to 1.0.29.
- 12 are refused on both builds, with different wording only (V2-P3-1, KNOWN).
- Every re-save is identical.

The only burn change on open is #1622 (ADR-580 Amd 2). Every saved height-map relief carves differently, by 0.1–0.2 mm on slopes and up to half a pixel at walls. The ADR names this, but nothing announces it yet.

The three returning-user fixes work on the case they were built for:
- **#1617:** Leave white unburned gives exactly a fresh import's burn on 6 logos. Undo is exact, and Output-off white is skipped.
- **#1619:** the 1.0.29 starter-made CNC is asked, and Start waits for the answer.
- **#1618:** a 1.0.29 interval copy plus its newer unload copy recovers the newer copy, and nothing is lost.

Each fix still misses a case a returning user will have:
- **X2-P1-1.** Copies of a 1.0.29 logo are not detected. Duplicate, Paste and Array drop `svgImport`, and the notice reads only `svgImport` groups. Four arrayed coasters are counted as "1 white shape". After Leave white unburned, the toast says the white is left unburned and the Job Review row goes. The 3 copies still burn their diamond over the black, +1,920 mm of lit travel each.
- **X2-P1-2.** #1619 does not ask about a converted laser whose owner followed 1.0.29's own advice for the `$30` mismatch: "Set $30=12000 (or update the machine profile)". Start then sends `M3 S1000`/`S12000` and `G4 P3.000` with no question and no advisory. A LightBurn-imported laser that 1.0.29 converted is not asked either, although Job Review's `$30` advisory names the beam.
- **X2-P2-1.** CNC pass and supervised recovery resume a 1.0.29 interrupted CNC job without the converted-laser question. ADR-637 Amd 8 promises "no job starts on that CNC until they answer".

The 1.0.30 notes on main are still 1.0.29's. The open draft #1638 covers 8 of v10's 9 owed lines; it lacks the missing-font notice (list at the end).

## Matrix

"Same" means byte-identical G-code. Pairs are the whole job, each output operation alone and each CSV record, compiled on 1.0.29 and on main.

| Project (saved by) | Pairs | G-code | Re-save main = re-save 1.0.29 | Open toasts on main | Verdict |
|---|---|---|---|---|---|
| 22 golden files (1.0.27–1.0.29: frames, unaffected, CNC, fill pool, photo, tabs, Studio, white logos) | 114 | 114 same | 22/22 | the same, plus the white-logo notice on `1.0.29-white-logos` (5 shapes) | Clean |
| v10 b1–b7 (text, embedded fonts, white logos, coaster, CNC adaptive and fallbacks, photos incl. 4.32 MP, cross-hatch) | 76 | 64 same; 12 refused on both (b2m missing font, wording only) | 16/16 | the same, plus the white notice on b3 (3 shapes) | Clean, V2-P3-1 KNOWN |
| v10 refuter g29 (CNC drill and tabs, Image Studio, jig layout, traced photo, welded text) and star/ring | 34 | 34 same | 11/11 | the same, plus the white notice on star and ring | Clean |
| Own logos `zz-x2\out\*-1029.lf2` (10 SVGs) | 10 | 10 same on open | n/a | the notice on all 10 | X2-P3-1, X2-P3-2 |
| Own logo copies (`dup-*`, Array) | 4 | same on open | n/a | the notice counts the original only | **X2-P1-1** |
| Own reliefs (ramp 0.5 mm px, dome 0.2 mm px, steps 0.25 mm px) | 3 | **3 differ** (intended, ADR-580 Amd 2) | n/a | "Opened" only | notes owed |
| Own CSS-transform SVGs (3) | 3 | same on open; Re-import moves parts | n/a | none on Re-import of CSS cases | X2-P3-3 |

## Findings

### X2-P1-1 — Copies of a 1.0.29 logo keep burning their white: the notice counts only the original, and Leave white unburned then reports success while the copies still double-burn

- **Where (af1573c77):**
  - `src/core/geometry/burning-imported-white.ts:23-33`: `svgImportGroups` keys on `object.svgImport?.id` only. `:46-57` (`countBurningImportedWhites`) reads only those groups, and `:50` also needs `svgImport.mode === 'fill'`.
  - `src/ui/state/saved-white-knockout.ts:37`: the action walks the same groups.
  - `src/core/geometry/white-fill-knockout.ts:176-183` (`fillShapes`): skips an object with no `svgImport` and no override mode.
  - The cause, on 1.0.29 and main alike: `src/ui/state/scene-object-copy-dependencies.ts:31,49-53`. Every copy drops `svgImport` unless the caller asks to keep it. Duplicate (`duplicate-scene-selection.ts:45`), Paste (`scene-clipboard-actions.ts:195`), Array (`array-selection-copies.ts:17`) and production nesting (`production-nest-part-materialize.ts:35`) do not ask. Retained arrays, board tiles and jig copies do.
- **Anchor:**
  - **Contract, ADR-686 Amendment 2 Consequences:** "one click gives the burn a fresh import gives", and "Job Review keeps the row until the white is left unburned, turned off, or kept with Undo". The row goes while white still burns.
  - **Twin:** the same logo imported fresh on main and then copied. Its copies carry no white.
  - **L11** and V2-P2-1 (P1 by its refuter and the coordinator).
- **Scenario:** on 1.0.29 a beginner imports the U3-style logo (black disc, white diamond) and copies it with Duplicate or Array for a batch of coasters. They update and open the project.
  - The toast says "This project has 1 white shape from an SVG import…".
  - Job Review shows the same row. They press **Leave white unburned**, and the toast reads "1 white shape is left unburned, as a new import of the file leaves it. Undo burns it again."
  - The row disappears, and the Tools command greys out (`countAfter 0`).
  - Every copy still burns its diamond a second time over the black.
- **Evidence:** REPRO (Node, 1.0.29's own store and `duplicateSelection` / `placeSelectionCopies`, saved by 1.0.29's `prepareProjectForPersistence`, opened and compiled on main).
  - `zz-x2\dup.mjs`:

    | Logos in the 1.0.29 file | With `svgImport` | Notice count | Lit before | After Leave white unburned | White paths still burning | Job Review row after |
    |---|---|---|---|---|---|---|
    | 1 (import only) | 1 | 1 | 5,473.9 mm | 3,553.9 | 0 | none |
    | 2 (1 Duplicate) | 1 | 1 | 10,947.8 | 9,027.8 | **1** | none |
    | 4 (3 Duplicates) | 1 | 1 | 21,895.6 | 19,975.6 | **3** | none |

  - `zz-x2\arr.mjs` (Array placements): 3 logos, 1 detected; after the action, 2 white paths still burn (16,421.7 → 14,501.7 mm) and the row is gone.
  - Per logo the extra is 1,920 mm of lit travel, the same 19.9 % dose V2-P2-1 measured.
- **Severity:** P1.
  - Wrong physical output: the white is burned twice over the solid fill, as in U3-P2-2 and V2-P2-1, both ledgered P1. It is reachable with ordinary batch work.
  - No warning remains after the fix: the app's own toast says the white is unburned, and the notice and row are withdrawn.
  - Before the fix, the notice under-counts (1 against 4). Display is not a warning (G6).
- **Announced?** No. ADR-686 Amd 2 "Not covered" lists strokes, near-white, PDF/AI and see-through white, not copies.
- **Novelty:** new. `grep` over `docs/audits` finds no copy/duplicate/array case for the white knock-out. No open PR touches these files.
- **Fix direction:**
  - Count and knock out white in every Fill-mode `imported-svg` object, not only `svgImport` groups. The object's own paths are one paint order, and the per-object dark/white test already holds within one object.
  - Alternatively, group copies by `source` plus path identity. Infer the mode from the white path's operation (`mode === 'fill'`) when `svgImport` is gone.
  - Add a returning-user fixture with a duplicated and an arrayed logo.
- **Refuter:** PENDING.

### X2-P1-2 — #1619 misses converted lasers that the owner adjusted the way 1.0.29 told them to, or that were not the starter; Start then fires `M3 S1000`/`S12000` with a 3 s dwell, unasked and (for the first) unwarned

- **Where (af1573c77):**
  - `src/core/preflight/converted-laser-profile.ts`:
    - `:59` and `:71-75` (`madeFromLaserStarter`) need the starter's `profileId`.
    - `:60` and `:77-84` (`spindleUntouched`) need KerfDesk's default RPM, spin-up and coolant.
    - `:62-64` drops the question once the controller reports `$30 > 1000`.
  - The advisory that remains: `src/core/preflight/controller-readiness-messages.ts:142` fires only when `$30` is below the profile's spindle max RPM.
  - What 1.0.29 did:
    - `df2279e26:src/ui/laser/device-setup/device-setup-auto-fill.ts:139,185-196` converts **any** unlisted laser-only draft on `$32=0`, not only the starter. A LightBurn import gets `profileId: lightburn-<name>` (`src/io/lightburn/lbdev-import.ts:104`).
    - `df2279e26:src/core/preflight/controller-readiness-messages.ts:129` told the owner: "Set $30=12000 (or update the machine profile) so S values map to real RPM."
- **Anchor:**
  - **Contract, ADR-637 Amendment 8 Consequences** (`docs/decisions/ADR-637-amendment-8-…md:92-93`): "A returning 1.0.29 user whose laser became a CNC sees the question … and no job starts on that CNC until they answer."
  - **Context of the same ADR:** "The saved machine cannot prove what it is … So KerfDesk must ask."
  - **L11** and V2-P2-2 (P1).
- **Scenario:**
  - (a) On 1.0.29 the fill made a stock-GRBL diode a CNC. At the first Start, Job Review showed 1.0.29's advisory, and the owner did what it said. Either they set the spindle max RPM to 1000 in Machine Setup, or they ticked Machine Setup's firmware write for `$30` to 12000. Smaller variants also defeat the check: a spin-up of 0 s to drop the pause, or coolant set to mist to drive air assist.
    - On main, the canvas banner and Job Review do not ask.
    - With the profile edited, no advisory fires either, because `$30` now equals the spindle RPM.
    - Start sends `M3 S1000` (= 100 % at `$30=1000`) or `M3 S12000` (= 100 % at `$30=12000`), then `G4 P3.000`, then rapids with no `S0`.
  - (b) A laser imported from a LightBurn `.lbdev`, or a saved profile with no `profileId`, was converted the same way by 1.0.29. It is never asked. Job Review keeps the reworded `$30` advisory, which names the beam.
- **Evidence:** REPRO (Node). 1.0.29's real `initDeviceSetup`, `planControllerAutoFill`, `deviceSetupReducer`, `machineSetupProfile` and `rememberLastMachine` ran on a stock-GRBL `$$` (`$30=1000`, `$32=0`). Main's `createStartupProject`, `convertedLaserQuestion`, a first square imported through main's store, `runControllerReadiness` and `startControllerPolicy` read the result.

  | Case (`zz-x2\prof.mjs`, `prof2.mjs`) | Asked before Connect | Asked after Connect | Laser-worded advisory | Program head |
  |---|---|---|---|---|
  | Starter as 1.0.29 left it (control) | yes | yes | yes | `M3 S12000 \| G4 P3.000 \| G0 X0.000 Y40.000` |
  | Starter, `$30=255`; starter renamed with a 300 mm bed | yes | yes | yes | same |
  | **Spindle max RPM set to 1000** | **no** | **no** | **no (0 advisories)** | `M3 S1000 \| G4 P3.000 \| G0 …` |
  | **Controller `$30` written to 12000** | yes (startup banner only) | **no** | **no** | `M3 S12000 \| G4 P3.000 \| G0 …` |
  | Spin-up set to 0 s | no | no | yes | `M3 S12000 \| G0 …` |
  | Coolant set to mist | no | no | yes | `M3 S12000 \| G4 P3.000 \| G0 …` |
  | LightBurn `.lbdev` laser (`lightburn-my-diode`), converted by 1.0.29 to `["cnc"]` | no | no | yes | `M3 S12000 \| G4 P3.000 \| G0 …` |
  | Profile with no `profileId`, converted to `["cnc"]` | no | no | yes | same |

  v10's refuter ran the simulated GRBL (`grbl-laser-power-model.ts`) on the same program, with the beam on through the dwell and 40 mm of rapids.
- **Severity:** P1 for (a), where it stands alone; (b) alone would be P2.
  - **For P1.** The output is the V2-P2-2 burn: full power held still, then lit travel. It is reachable today on main, and for the edited-profile case nothing on main says "laser". METHOD §3 has no reach clause. V2's refuter already ruled that the app's inability to tell a laser from a router limits the fix, not the severity. The edits that defeat the check are the ones 1.0.29's own message asked for.
  - **Against.** An owner who edited CNC settings made a CNC choice, which ADR-637 Amd 8 reads as router evidence on purpose. This needs a 1.0.29 user who kept running the CNC path after seeing it once. For (b), the advisory is a clear warning before output.
- **Announced?** No. The ADR does not list these cases under "Not covered", and its notes line says the converted laser "is asked before any job starts".
- **Novelty:** new. V2-P2-2 and ADR-637 Amd 8 consider the starter only. No open PR touches `converted-laser-profile.ts`.
- **Fix direction:**
  - Widen the check to any CNC whose stored profile was a laser before 1.0.29's fill. Use the evidence the profile already carries: a laser-only `profileSource: 'lightburn'`, laser fields such as `maxPowerS`, and `laserModeEnabled` in the document.
  - Do not treat RPM, spin-up or coolant edits as an answer while the profile still says "Default 400×400" or `lightburn-*`, and do not treat a `$30` above 1000 as one either. Only an explicit answer ends the question.
  - Keep the `$30` advisory's laser wording whenever `$32=0` and a CNC Start runs on a profile that was a laser.
- **Refuter:** PENDING.

### X2-P2-1 — CNC pass and supervised recovery start a 1.0.29 interrupted CNC job without the converted-laser question

- **Where (af1573c77):**
  - `src/ui/laser/cnc-pass-recovery-flow.ts:60-87,241-249` and `src/ui/laser/cnc-supervised-recovery-flow.ts:78-101,270-283` attest and stream with `CNC_SETUP_ATTESTATION_PROMPT` and `jobAwareConfirm`. Neither reads `convertedLaserQuestion` (`grep convertedLaser src/ui` finds only the banner, Machine Setup and Job Review).
  - The question gates only `runJobReviewGate` (`job-review-gate.ts:248`, `job-review-converted-laser.ts:24-26`), whose only caller is `framed-run-start-review.ts:51`.
  - The banner's **Not now** promises the opposite (`src/ui/app/MachineSetupBanner.tsx:125`): "Job Review asks again before Start."
- **Anchor:** Contract. ADR-637 Amendment 8 Consequences (`:92-93`): "no job starts on that CNC until they answer". Decision 2: Not now "only hides the card for this launch".
- **Scenario:**
  - On 1.0.29 the converted diode fired at Start. The owner aborted, which left a CNC recovery record (a sealed exact-execution artifact; v10 showed 1.0.29 artifacts load on main).
  - On main they press **Not now** on the canvas question, then open the recovery card's **Resume from pass**. The recovery confirms and streams the archived program from that pass, with its spindle start and dwell.
  - The open project must be CNC (`cnc-recovery-open-project.ts:24-28`), and it is, because the machine restored as CNC.
- **Evidence:** READ.
  - The warning that does reach the operator: `prepareArchivedRecoverySource` qualifies through `finalizeStartPreparation`, whose warnings include `controllerPolicy.advisories` (`start-job-readiness.ts:360,392`; `start-job-source.ts:313`). `confirmWarnings` shows them before the plan (`cnc-pass-recovery-flow.ts:157-158`).
  - With `$30 ≤ 1000` that includes the laser-worded advisory ("…if this machine is a laser, it is set up as a CNC and this job fires the beam at full power, so do not start it…", `controller-readiness-messages.ts:142`). For the X2-P1-2 (a) machines it does not.
  - Not run: the recovery wizards need a live controller qualification (`requireFreshControllerQualification`).
- **Severity:** P2. The ADR's contract breaks on a clear path. The default case still shows a clear beam warning in the recovery's "Controller warning" confirm, so it is not P1 on its own. It becomes P1 on an X2-P1-2 (a) machine, which X2-P1-2 already carries.
- **Announced?** No.
- **Novelty:** new. No audit or open PR covers recovery against ADR-637 Amd 8.
- **Fix direction:** have both CNC recovery flows refuse to start, with the same question, while `convertedLaserQuestion` is open for the open project's machine. Or route their start through the same review question.
- **Refuter:** PENDING.

### X2-P3-1 — For a 1.0.29 logo whose white is see-through, a gradient or masked, the offer claims "as a new import does", but the knock-out cuts what a new import keeps

- **Where:**
  - `src/core/geometry/white-fill-knockout.ts:170-172`: `isPaperWhite` needs `whiteInk === undefined`, and 1.0.29 never wrote `whiteInk`.
  - The wording is in `src/ui/state/saved-white-notice.ts:32-43` ("To leave the white unburned, as a new import does") and `src/ui/state/saved-white-knockout.ts:110-116` ("…as a new import of the file leaves them").
- **Anchor:** Twin. The fresh import on main follows ADR-686 Amendment 1 (see-through, gradient and masked white are ink).
- **Scenario and evidence:** REPRO (`zz-x2\white.mjs`). A 40 mm black square with a centred r=10 circle in white, imported and saved by 1.0.29:

  | Circle | 1.0.29 stores | Lit on open | After Leave white unburned | Same SVG imported on main |
  |---|---|---|---|---|
  | `fill-opacity="0.5"` | `#ffffff`, no mark | 19,133.2 mm | 12,866.8 | 19,133.2 (`whiteInk: translucent`) |
  | white-to-white gradient | same | 19,133.2 | 12,866.8 | 19,133.2 (`gradient`) |
  | masked | same | 19,133.2 | 12,866.8 | 19,133.2 (`masked`) |

  The knock-out cuts a hole and removes 6,266 mm (−33 %) that a fresh import burns.
- **Severity:** P3. The change needs the operator's click, it does what the button says ("leave the white unburned"), and the canvas then shows the hole. The claim of parity with a new import is false. ADR-686 Amd 2 lists "a see-through white saved by 1.0.29" as not covered; gradient and masked are not listed.
- **Fix direction:** drop "as a new import does" from both texts, or say that see-through, gradient and masked white cannot be told apart in a project saved before this version.
- **Novelty:** new wording issue. The limitation itself is named in ADR-686 Amd 2.
- **Refuter:** PENDING.

### X2-P3-2 — The white count is looser than the knock-out: a main-made import whose white covers every darker shape is blamed on 1.0.29, and the button then does nothing but silence the notice

- **Where:**
  - `src/core/geometry/burning-imported-white.ts:46-57`: counts any unmarked white beside a darker fill.
  - `src/ui/state/import-white-knockout.ts:44`: a fresh import whose white covers every darker shape is left as parsed **without** a `kept` mark.
  - `src/ui/state/saved-white-knockout.ts:44-47,53`: the saved-logo action marks that white `kept` and returns 0, so no toast appears.
- **Anchor:** Twin. Import (`applyImportWhiteKnockout`) versus open count. ADR-686 Amd 2 Decision 1 text: "as KerfDesk 1.0.29 and earlier imported white".
- **Evidence:** REPRO (`zz-x2\white.mjs`, `white2.mjs`).
  - **`fullcover`** (a black 30 mm square fully under a white one):
    - Fresh import on main, then opened on main: count 1. The notice says "…as KerfDesk 1.0.29 and earlier imported white".
    - The button returns 0, shows no toast, and the burn is unchanged (18,000 mm). The notice and the Job Review row are gone.
  - **`darkOff`** (the 1.0.29 star with its black operation's Output off):
    - The only burn is the white star, 6,174 mm. The notice says it "burns over the darker fill under it".
    - The button leaves 0 mm, an empty job.
- **Severity:** P3. Edge layouts, consent-gated, and visible on the canvas. The wording is wrong, and a no-op action ends the offer silently.
- **Fix direction:**
  - Count only white that the knock-out would actually remove and cut (or run the knock-out geometry lazily).
  - Mark a fresh import's left-as-parsed white `kept`, as the saved path does.
  - Skip white whose darker neighbours all have Output off.
- **Novelty:** new.
- **Refuter:** PENDING.

### X2-P3-3 — Re-import of an older import silently moves CSS-transformed parts (#1635); no note says the part moved

- **Where:** `src/io/svg/svg-element-transform.ts` (new reader), `src/io/svg/svg-import-notes.ts` (notes only for invalid or approximated transforms). Re-import: `src/ui/state/svg-fragment-reimport.ts`.
- **Anchor:** L11 rule (a burn change in an existing project must be announced). ADR-574 Amendment 1 Decision 9 ("Nothing moves silently") is scoped to invalid transforms. Its Consequences do not mention Re-import of older imports or the update notes.
- **Evidence:** REPRO (`zz-x2\css.mjs`). Each SVG was imported and saved by 1.0.29. Opening on main burns the same, but Re-importing the same file on main does not:

  | SVG | 1.0.29 burn box (mm) | After Re-import on main | Note shown |
  |---|---|---|---|
  | `style="transform: translateX(20px)"` | X 170–180 | X 170–**200** (part moved 20 mm) | none |
  | `<style>` rule `rotate(45deg)` with `transform-origin: 25px 25px` | X 162.97–180, Y 177.6–219.9 | X 170–202.07, Y 188–219.9 | none |
  | attribute `transform="translate(20px)"` | X 170–200 | X 170–180 (moved back 20 mm) | yes: the invalid-transform warning |

- **Severity:** P3. Re-import is an explicit action, and the new placement matches a browser (correct). The change to an existing burn is not named on Re-import or in the notes.
- **Fix direction:** add a line to the 1.0.30 notes. Optionally, when Re-import moves a part that carries a CSS transform, say so in the Re-import toast.
- **Novelty:** new. W5 and 14-P3-1 covered fresh imports.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"The open toast 'The project handoff succeeded, but an older recovery snapshot could not be cleared…' is new on main."** It appears in whichever open runs when the asynchronous `clearAutosaveAfterFileHandoff` settles, without IndexedDB in the harness. It shows on 1.0.29 too (b6-photo-large: the toast lists differ only by it).
- **"#1618 loses the newer copy when its old session's lock cannot be proved free."** With no Web Locks the clear returns `retained` and both copies stay; with a lock manager it clears both after the re-home. Nothing is lost either way (`zz-x2\autosave.mjs`, both runs).
- **"#1622 makes reliefs shallower somewhere."** The dome's 0.1 mm bins show up to 0.199 mm shallower at its rim and 0.206 mm deeper elsewhere. That is the pixel-centre surface against the old highest-pixel cells, as ADR-580 Amd 2 describes. The step's bins show up to 1.38 mm deeper beside the walls, because the wall moves by up to half a pixel ("A vertical step between two pixels becomes a one-pixel slope"). Intended and named. X6 owns the geometry.

## Verified clean

- **#1617 on the case it targets** (`zz-x2\white.mjs`, `white2.mjs`; Vitest `returning-user-white-fills.test.ts` and `svg-white-fill-knockout-v10.integration.test.ts` pass):
  - Opening changes no burn: 10/10 own logos, the golden file and b3 are byte-identical to 1.0.29.
  - Leave white unburned equals a fresh main import, byte for byte, on U3's logo, the plate, star, ring, white-beside-only and white-painted-first. Lit lengths: 5,792.984 → 3,872.984 mm; 13,140 → 10,860; 31,174 → 18,826; 13,795.158 → 7,528.83; 6,002.764 → 4,000; 19,133.164 → 3,133.164.
  - Undo gives the original G-code, and the white is marked `kept`. The notice does not come back, even after a save and reopen. That save burns identically on 1.0.29, which ignores `whiteInk`.
  - White whose operations are all Output off is skipped: count 0, nothing changes (star 25,000 mm, plate 12,000 mm). A white path on two operations, one still on, is counted and cut correctly.
  - No route changes a burn without consent: Open, template, autosave restore and sheet switch only pass the project to the notice. Re-import applies the import knock-out, an explicit action, as before.
- **#1619 on the starter** (`zz-x2\prof.mjs`; Vitest `converted-laser-profile`, `converted-laser-question` and `job-review-converted-laser` pass):
  - The starter made a CNC by 1.0.29 is asked offline and after Connect, with `$30=1000` or `255`, renamed or with an edited bed.
  - The Job Review store refuses confirm while asking (`job-review-store.ts:144`), and the gate never confirms such a model. The phone presenter holds (`machine-review-presenter.ts:57`).
  - Real routers set up with their own spindle are not asked. G-code is unchanged for every machine.
- **#1618 with real 1.0.29 storage** (`zz-x2\autosave.mjs`, fake IndexedDB, jsdom localStorage, 1.0.29's own `AutosaveDurableService.write` and `writeLocalAutosave`):
  - An interval copy at 1000 plus an unload copy at 2000 in one session is offered once, as the unload copy (A-v2), with the IndexedDB epoch carried.
  - A second session (B) is listed separately.
  - Restore re-homes A-v2 into the new window, then clears both A copies; B stays. Without a lock manager the source is retained, not lost.
  - Vitest `recover-unload-copy.test.ts` passes (with `--no-experimental-webstorage`, Node 25 quirk).
- **Burn identity of #1601, #1602, #1603, #1606, #1607 and #1608:**
  - Text: the 7 golden frame files, b1, b2 (4.6 MB CFF), w1 welded text with CSV.
  - CNC: b5 adaptive, ball-nose and big-bit fallbacks, raster pocket, profile tabs, V-carve; g29 drill and tabs.
  - Fill: golden fill-pool and b7 cross-hatch.
  - All are byte-identical between 1.0.29 and main. `EMITTER_REVISION` changed (v42), but it is not in the emitted program.
- **Stored fields:**
  - The only new stored field since 1.0.29 is the optional `ColoredPath.whiteInk` (#1617). The validator passes unknown path fields through, and 1.0.29 opens a main save carrying `whiteInk: 'kept'` and burns it identically.
  - `PROJECT_SCHEMA_VERSION` is still 21. `src/io/project` and `src/core/devices` are unchanged since `5f09e1110`.
- **CI on the merged result:**
  - #1617 and #1618 ran on later merges: `a3965a77d` (#1619) passed CI, Browser smoke and Desktop package.
  - `743d37bc4` (#1622): CI passed, Browser smoke **failed**. Open PR #1646 says it fixes main's smoke after #1622; that belongs to X6/X7.
  - `af1573c77`: CI passed; Browser smoke and Desktop package were queued when checked.

## Not verified

- **Rendered UI.** No browser run (memory was 0.4–2.9 GB during the session). Toasts, the Job Review row and button, and the canvas question were read from the functions that build them. Start-disabled was checked through the store and the repo's Vitest, not rendered.
- **The CNC recovery wizards (X2-P2-1)** were read, not run: they need a qualified live controller.
- **Paste and production nesting copies (X2-P1-1)** were read; Duplicate and Array placements were reproduced.
- **The app-wide router answer** (`kerfdesk.converted-laser-answer.v1`): saving any CNC in Machine Setup on main (`use-machine-setup-save.ts:100-106`) answers for every machine, including a converted laser in a 1.0.29 project opened later. This was not reproduced, so it is not raised.
- **Relief roughing time and air-cut.** Compile only; no physical depth is claimed.
- **Fresh 1.0.28 saves, barcode, box, rotary, tiles, print-and-cut, sheets, phone and MCP edits.** Not covered beyond the golden set.
- **Hardware:** none, by instruction.

## Update notes for 1.0.30

`docs/releases/desktop-update-notes.json` on main still holds 1.0.29's notes (`sinceSourceSha` = 1.0.28 `33bc394c6`), so every line below is missing on main. Open PR #1638 (draft notes, `sinceSourceSha` = `df2279e26`, not merged) was checked against v10's list:

| Line owed (v10 list) | In #1638? |
|---|---|
| White knock-out on import, and the offer for older logos | yes (highlight 4) |
| Stale-CNC laser check | yes (2) |
| Cut last | yes (3) |
| Before you start | yes (3) |
| Recover unsaved work | yes (6) |
| CNC adaptive-fallback notice | yes (6) |
| GRBL laser-mode ETA change | yes (5) |
| Origin restore after Abort | yes (1) |
| **New missing-font open notice (#1595)** | **missing** |

Lines this audit adds or finds only partly covered:
- **Re-import of a pre-update logo now removes its white shapes** (ADR-686 D1). #1638 says only "Re-import keeps settings". Partial.
- **Saved height-map reliefs carve differently** (#1622, ADR-580 Amd 2): up to 0.1–0.2 mm on slopes, and walls become one-pixel slopes. #1638 says "height maps carve their true surface", which does not tell a returning user that a saved relief will cut differently. Partial. The ADR records no notes line.
- **Re-import of an SVG with CSS transforms moves those parts** (#1635, X2-P3-3). #1638 says "SVG CSS transforms … import as drawn". Partial.
- Once fixed: duplicated or arrayed older logos (X2-P1-1), and the wider converted-laser check (X2-P1-2, X2-P2-1).

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x2\`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `build.mjs`, `entry-*.ts`, `bundles\` | esbuild bundles: `main` (j14-main), `old29` (v10's), `auto-*` (autosave), `rel-*` (relief fixture) |
| `h.mjs`, `dom.mjs` | Open (store + `completeNativeProjectOpen`, with the migrated-device preset), compile, save, diff |
| `c1.mjs` | Open on 1.0.29 and main, compile job, each op and records, re-save, toasts (the Matrix) |
| `white.mjs`, `white2.mjs` | #1617 cases, Undo, Output off |
| `dup.mjs`, `arr.mjs` | X2-P1-1 (Duplicate, Array) |
| `prof.mjs`, `prof2.mjs` | #1619 cases, X2-P1-2 |
| `autosave.mjs` | #1618 with 1.0.29 storage |
| `relief.mjs`, `relief2.mjs` | #1622 diffs and depth bins |
| `css.mjs` | #1635 Re-import, X2-P3-3 |
| `out\` | Every file 1.0.29 saved for this audit |

Vitest (focused, one worker, `NODE_OPTIONS=--no-experimental-webstorage`, in j14-main): `returning-user-white-fills`, `svg-white-fill-knockout-v10.integration`, `converted-laser-question`, `converted-laser-profile`, `job-review-converted-laser` and `recover-unload-copy`. Result: 6 files, 39 tests passed.

```json
{
  "area": "X2",
  "id": "returning-user",
  "tree": "af1573c77",
  "older": ["df2279e26 (v10 export)", "golden files 1.0.27-1.0.29"],
  "raised": 6,
  "pairs": { "golden": 114, "v10_scenes": 110, "same": 212, "refused_both_wording_only": 12, "relief_intended_diffs": 3 },
  "findings": [
    {"id": "X2-P1-1", "severity": "P1", "area": "X2", "file": "src/core/geometry/burning-imported-white.ts", "line": 26, "anchor": "Contract ADR-686 Amd 2 Consequences; twin: fresh import then copy; L11", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Copies (Duplicate, Paste, Array, nesting) of a 1.0.29 logo drop svgImport, so the notice counts only the original; Leave white unburned then toasts success and removes the row while each copy still burns its white over the black (+1,920 mm lit per copy; 4 logos: 3 still wrong)"},
    {"id": "X2-P1-2", "severity": "P1", "area": "X2", "file": "src/core/preflight/converted-laser-profile.ts", "line": 59, "anchor": "Contract ADR-637 Amd 8 Consequences; L11; V2-P2-2", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Converted lasers not asked: spindle RPM/spin-up/coolant edited or $30 written >1000 (as 1.0.29's own $30 advisory suggested), or a non-starter profile (LightBurn .lbdev, no profileId) that 1.0.29 also converted; edited-RPM and $30=12000 cases also lose the advisory; Start sends M3 S1000/S12000 + G4 P3.000 + lit rapids. (b) alone would be P2"},
    {"id": "X2-P2-1", "severity": "P2", "area": "X2", "file": "src/ui/laser/cnc-pass-recovery-flow.ts", "line": 241, "anchor": "Contract ADR-637 Amd 8 Consequences and D2 (Not now)", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "CNC pass and supervised recovery stream a 1.0.29 interrupted CNC job without the converted-laser question; the banner's Not now promises Job Review asks before Start; only the $30 advisory (laser-worded at $30<=1000) warns in the recovery confirm"},
    {"id": "X2-P3-1", "severity": "P3", "area": "X2", "file": "src/ui/state/saved-white-notice.ts", "line": 32, "anchor": "Twin: fresh import (ADR-686 Amd 1)", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "1.0.29 see-through/gradient/masked white is offered as paper with 'as a new import does'; the knock-out removes 6,266 mm (-33%) that a fresh import burns"},
    {"id": "X2-P3-2", "severity": "P3", "area": "X2", "file": "src/core/geometry/burning-imported-white.ts", "line": 46, "anchor": "Twin: applyImportWhiteKnockout vs open count", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Full-cover white on a main import is blamed on 1.0.29 and the button silently no-ops while ending the offer; white over an Output-off dark fill is said to burn over it and the button empties the job"},
    {"id": "X2-P3-3", "severity": "P3", "area": "X2", "file": "src/io/svg/svg-element-transform.ts", "line": 1, "anchor": "L11; ADR-574 Amd 1 D9 scope", "evidence": "REPRO", "verdict": "PENDING", "known": false, "summary": "Re-import of a 1.0.29 import with CSS transforms moves those parts (20 mm; rotation about a new origin) with no note; correct per browser but unannounced"}
  ]
}
```

## Refuter (2026-11-09)

Fresh refuter, separate context. Code: the scratchpad tree `j14-main`; the 11 files cited below match `af1573c77` (`git rev-parse af1573c77:<path>` = `git hash-object`). Older code: v10's `old29` export (`df2279e26`), read only. I built my own esbuild bundles of both trees (`zz-x2r\bundles\`), my own harness (`zz-x2r\h.mjs`) and my own SVGs, so none of the auditor's files or saved scenes were reused. For X2-P2-1 I ran Vitest in a scratch copy of `j14-main` (`zz-x2r\mut`, `node_modules` a junction) with one added test file. It used the repo's recovery fixtures, the real 1.0.29 last-machine document and the GRBL model `grbl-laser-power-model.ts` as the simulated controller. No hardware was used.

**Memory gate.** The first Vitest run that completed (15:08) launched at 1,390 MB available, below the 1.5 GB gate. My command printed the reading but did not stop on it. The final run (15:10, the one quoted) launched at 2,338 MB. Every other run used Node only.

### Verdicts

**X2-P1-1: CONFIRMED P1.**

- **Cause, read at af1573c77.**
  - `src/ui/state/scene-object-copy-dependencies.ts:31,49-53` drops `svgImport` from every copy unless the caller passes `preserveSvgImport`. Duplicate (`duplicate-scene-selection.ts:45`), Paste (`scene-clipboard-actions.ts:195`) and the later placements of Array (`array-selection-copies.ts:17`) do not pass it. Array's first placement does (`array-first-placement.ts:50-51`).
  - 1.0.29 has the same code, so a 1.0.29 file stores its copies without `svgImport`.
  - `burning-imported-white.ts:23-33` groups only by `svgImport.id`.
  - `saved-white-knockout.ts:37` walks only those groups.
  - `white-fill-knockout.ts:176-178` skips a part with neither `svgImport` nor an override mode.
- **REPRO** (`zz-x2r\p11.mjs`). The logo is my own: a dark-grey (#333) rounded plate with three white shapes, written as `style="fill:#fff"`, `fill="white"` and `#FFFFFF`. On 1.0.29 I imported it and copied it with the store's real `duplicateSelection`, `copySelection` + `pasteClipboard` (twice) and `arraySelection` (grid 1 × 3). I then moved the copies apart and saved with 1.0.29's `prepareProjectForPersistence`. Each file was opened on main through `completeNativeProjectOpen`. G-code on open is byte-identical to 1.0.29 in all 4 cases.

  | Case (logos) | Notice and button count | Toast after the button | Lit before | After the button | Fresh import on main, same copies | Row after |
  |---|---|---|---|---|---|---|
  | Import only (1) | 3 | "3 white shapes are left unburned, as a new import of the file leaves them…" | 17,319.6 mm | 12,399.0 | 12,399.0 | 0 |
  | Duplicate ×3 (4) | 3 (12 white paths) | the same "3 white shapes…" | 69,278.5 | **64,357.8** | 49,595.9 | **0** |
  | Paste ×2 (3) | 3 (9) | the same | 51,958.9 | **47,038.2** | 37,196.9 | **0** |
  | Array 1×3 (3) | 3 (9) | the same | 51,958.9 | **47,038.2** | 37,196.9 | **0** |

  - Each copy keeps 4,920.6 mm of lit travel (+39.7 %) over a fresh import's copy, all of it inside the white shapes. The fresh import's copies carry no white path.
  - After the button: `countBurningImportedWhites` = 0, `burningWhiteReviewWarnings` = 0, and Tools greys out.
- **What would make it false.**
  - (a) A guard upstream: none. Nothing else in `src/core/preflight` or `src/ui/laser/job-review` reads white fills. ADR-686 Amd 1's `countInkWhiteFills` runs only at import.
  - (b) A clear warning before output: none remains. The success toast and the withdrawn row and notice say the opposite.
- **The canvas** does show the copies differently. After the button the original paints with holes, while each copy still paints solid, because artwork rests in plain ink (`src/ui/workspace/object-display.ts:248,272`, ADR-620) and the copy's white is drawn as ink over the black. That difference is display only and is not a warning (METHOD §3, G6). The toast's count (3 against the 12 shapes that exist) is not a warning either.
- **Correction to the auditor's harness.** Duplicate places the copy in place. Identical overlapping fills in one operation cancel: main and 1.0.29 both emit no lit move for 2, 4 or 8 stacked copies (`lit 0`). The auditor's and my repros move the copies apart, which is what an operator does. The result holds either way.

**X2-P1-2: CONFIRMED P1 for case (a), on the spindle-RPM route. (a) with `$30` = 12000 alone and (b) alone are P2.**

- **REPRO** (`zz-x2r\p12.mjs`, `p12fw.mjs`). Each 1.0.29 machine was made by 1.0.29's own `initDeviceSetup`, `planControllerAutoFill`, `deviceSetupReducer`, `machineSetupProfile` and `rememberLastMachine` on a stock-GRBL `$$` (`$30`=1000, `$32`=0). On main I then ran `createStartupProject`, `convertedLaserQuestion`, a 30 mm square imported through main's store, `runControllerReadiness` and `startControllerPolicy`, and fed the program to the GRBL model with `$32`=0.

  | 1.0.29 machine | Asked before Connect | Asked after Connect | Advisories | Program head | GRBL model |
  |---|---|---|---|---|---|
  | Starter, fill only (control) | yes | yes | 1, laser-worded | `M3 S12000 \| G4 P3.000 \| G0 …` | beam on through the dwell, 30 mm of lit rapids |
  | **Starter, spindle max RPM 1000** (1.0.29's `accept-detected` with `useSpindleScaleAsRpm`, the "Use configured S maximum 1000 as spindle RPM" box) | **no** | **no** | **0** | `M3 S1000 \| G4 P3.000 \| G0 …` | S1000 = full scale at `$30`=1000; dwell lit; 30 mm lit rapids |
  | Starter, controller `$30` written to 12000 | yes (startup card) | **no** | **0** | `M3 S12000 \| G4 P3.000 \| G0 …` | full scale; dwell lit; lit rapids |
  | `.lbdev` through 1.0.29's own `importLightBurnDeviceProfile` (`lightburn-shop-diode-10w`), then the fill | no | no | 1, laser-worded | `M3 S12000 \| G4 P3.000` | dwell lit; lit rapids |
  | No `profileId`, then the fill | no | no | 1, laser-worded | the same | the same |

- **Did 1.0.29 really convert these machines?**
  - **`.lbdev`: yes.** The machine kinds came out `["cnc"]`. `lbdev-import.ts:104` gives the profile `lightburn-<name>`, and it is not a listed machine, so `machineKindFromLaserMode` (`df2279e26:…/device-setup-auto-fill.ts:139,185-194`) converts it. This needs the controller at `$32`=0, which LightBurn users often change to 1, so reach is narrower than the starter's.
  - **No `profileId`: the fill converts it too,** but I found no 1.0.29 writer that drops `profileId` (grep). Reaching it needs an older, hand-made or third-party profile document. Unproven reach.
- **Are the `$30` and RPM routes 1.0.29's own?** Yes, and both are opt-in.
  - **`$30`.** 1.0.29's Firmware step proposes **`$30` 1000 → 12000, "Maximum spindle speed", writable** for the converted CNC: `computeFirmwareDiffs` with the setup's `draftMachine` (`df2279e26:…/device-setup-firmware-diff.ts:124`). It is written only after "Confirm write $30". The 1.0.29 `$30` advisory said the same.
  - **Spindle RPM.** The RPM can be set in two ways. The first is the CNC machine step's Spindle max RPM field, which the advisory's "or update the machine profile" points to. The second is the "Use configured S maximum … as spindle RPM" box.
  - **When the box shows.** The box is shown only by the explicit Use detected values panel. That panel appears when a later Connect finds values that differ from the setup, not under the first automatic fill (`DeviceSetupFoundMachine.tsx:46-56,143-177`), so the box route is conditional. The field route is not.
- **Is a profile deliberately edited to spindle RPM still a laser?** Physically yes: the machine is a diode, and the profile only describes it. ADR-637 Amd 8 Decision 1 does name "Nobody set its spindle" as a condition, and `converted-laser-profile.test.ts` tests it. So the gap is a documented design choice, but it is not listed under "Not covered", and the Consequences promise that the converted laser is asked. The owner made those edits on 1.0.29's own advice, inside a CNC setup they never chose. As V2's refuter ruled, the app's inability to tell a laser from a router limits the fix, not the severity.
- **Why (a) stays P1.**
  - The output is the V2-P2-2 burn, which was ledgered P1, and it is reachable today on main.
  - On the RPM-edited machine nothing names a laser: there is no question, no advisory, and no laser wording in the recovery confirms (X2-P2-1 below). What remains is the CNC path: the Router workspace and the "Before starting the CNC spindle" attestation (`cnc-setup-attestation.ts:4`). The U8-P2-1 ledger found that path insufficient.
- **Why (a) with `$30`=12000 alone would be P2.** The startup card asks the full question, beam wording included, before Connect, so a clear warning does reach the operator. It then withdraws after Connect (`converted-laser-profile.ts:62-64`), and Job Review neither asks nor advises, which breaks the banner's own promise "Job Review asks again before Start" (`MachineSetupBanner.tsx:125`).
- **(b)** keeps the laser-worded `$30` advisory ("…this job fires the beam at full power, so do not start it…", `controller-readiness-messages.ts:141-142`). That is a clear warning, so P2, as the auditor says.

**X2-P2-1: CONFIRMED P2 (REPRO; it was READ).**

- **REPRO.** `zz-x2r\mut\src\ui\laser\zz-x2r-recovery.test.ts`, run in the scratch copy only: 4 tests pass. The output is in `zz-x2r\out\recovery.json` and `vt-recovery.txt`.
  - The project is main's `createStartupProject()` restored from the real `1.0.29-laser-made-cnc-last-machine.json`, with a 3-pass CNC line, and the controller is a stock diode (`$30`=1000, `$32`=0).
  - `convertedLaserQuestion` is **open** for it.
  - The capsule is the repo's own interrupted-run fixture (`saveInterruptedRun`), and `jobAwareConfirm` answers yes.
- **What runs.**
  - `runCncPassRecoveryFlow` and `runCncSupervisedRecoveryFlow` both **start**: `startJob` is called once. Neither shows the question or reads `convertedLaserQuestion`.
  - The streamed program begins `M3 S12000 | G4 P3.000 | G0 X10.000 Y390.000` (supervised: `G0 X25.000 Y390.000`).
  - On the GRBL model at `$32`=0, the spindle (the beam) is on at S12000 through the dwell and over 510.1 / 510.8 mm of rapids.
- **The warning that reaches the operator.** The prompts in order are "Controller warning:", then the pass or supervised plan, then "Before starting the CNC spindle…". The first holds the laser-worded advisory verbatim: "• Controller $30 is 1000 but this machine's spindle max RPM is 12000. 1000 is the scale lasers use: if this machine is a laser, it is set up as a CNC and this job fires the beam at full power, so do not start it; open Machine Setup and choose Laser.…" (`cnc-pass-recovery-flow.ts:157-158,257-261`; `cnc-supervised-recovery-flow.ts:271,354-357`). That is a clear warning before output, so P2 stands rather than P1. The ADR-637 Amd 8 contract ("no job starts on that CNC until they answer") and the banner's Not now promise are still broken on a clear path.
- **On the RPM-edited machine** (spindle 1000), both flows stream `M3 S1000 | G4 P3.000` with no laser wording in any prompt. The question is not open for that machine at all, so this is X2-P1-2 (a), not a separate defect.
- **Limit.** The capsule was sealed by main's own `prepareCurrentStartJob`, standing in for a 1.0.29 artifact (v10 showed that 1.0.29 artifacts load on main).

**X2-P3-1: CONFIRMED P3** (`zz-x2r\p3.mjs`, own SVGs). Each logo is a 40 mm black square with a white r=8 circle, saved by 1.0.29.

| White written as | 1.0.29 stores | On open | After the button | The same SVG imported on main |
|---|---|---|---|---|
| `opacity="0.6"` | `#ffffff`, no mark | 18,002.8 mm | 13,997.2 | 18,002.8 (`translucent`) |
| `style="fill:rgba(255,255,255,0.5)"` | the same | 18,002.8 | 13,997.2 | 18,002.8 (`translucent`) |
| white-to-white radial gradient | the same | 18,002.8 | 13,997.2 | 18,002.8 (`gradient`) |

- "As a new import does" is false: the button cuts 22 % that a new import burns.
- It needs a click, and the canvas then shows the hole. ADR-686 Amd 2 names see-through white as not covered; gradient (and mask) are not named.

**X2-P3-2: CONFIRMED P3** (`p3.mjs`).

- **Output off (`darkOff`).** My slate case is a grey disc with a white square, whose grey operation had Output turned off on 1.0.29 so that only the white burns.
  - The count is 1, and the notice says the white "burns over the darker fill under it".
  - The only burn is 2,560 mm. After the button the job burns 0 mm.
- **`fullcover`.** A dark disc lies fully under a larger white disc, imported and saved on **main**.
  - The count is 1, and the notice blames "KerfDesk 1.0.29 and earlier".
  - The button returns 0 and shows no toast, and the burn is unchanged (10,188.3 mm). Afterwards the count and the row are 0.
- Both cases need the operator's click and are visible in Preview, so they stay P3.

**X2-P3-3: CONFIRMED P3, with a narrower scope** (`p33.mjs`, `p33b.mjs`).

- **What 1.0.29 already applied.** For SVG-syntax functions in a `style` transform, 1.0.29 already applied them, and Re-import on main burns exactly as 1.0.29 did:
  - `translate(15px, 5px)` on a `<g>`;
  - `scale(1.5)` on a `<rect>`;
  - a `<style>` class with `rotate(30deg)`.
- **What moves.** Only CSS-only forms move.
  - My `style="transform: translateY(15px)"` part is placed as 1.0.29 placed it on open, and moves 15 mm in Y on Re-import (lit Y range 210–220 becomes 195–220).
  - No parse note and no toast appear.
  - The outcome was `kept 0, added 1, removed 1`: Re-import treats the moved part as new.
  - The auditor's `translateX` and `transform-origin` cases fit the same rule.
- **Wording.** The finding and the notes line should say "CSS-only transform functions (`translateX`/`translateY`, `transform-origin`)", not all CSS transforms.

### Challenges to "Verified clean"

- **Byte identity on other inputs: holds** (`zz-x2r\clean.mjs`).
  - **Five new scenes built on 1.0.29:**
    - curves (cubic, arc, polyline) in Line mode;
    - an even-odd frame with an island in offset fill at 2 passes;
    - an angled one-way cross-hatch at 0.2 mm;
    - a kerf + tabs + air cut;
    - a black fill with Output off beside a line with a minimum power.
  - **v10 refuter's 9 1.0.28 saves (`zz-v2r\out\g28`):** CNC drill, inside and outside tabs with ramp, three Image Studio files, jig layout, traced photo and welded text.
  - **Result:** 14/14 G-code pairs are byte-identical between 1.0.29 and main, 14/14 re-saves are identical, and open toasts are identical. The one difference seen (`c1-cnc-drill`) came from run order and vanished when that file was opened alone (`toast.mjs`).
  - **Plus** the 4 copy files from X2-P1-1 (`same29: true`).
- **Re-import of CSS transforms** narrows X2-P3-3, as described above.
- **PR #1638** (`gh pr diff 1638`, head `fa5c1895a`). It touches only `docs/releases/desktop-update-notes.json`, with `sinceSourceSha` `df2279e26`.
  - The #1622 relief change appears only as "CNC Preview shows when adaptive clearing falls back; height maps carve their true surface." That does not tell a returning user that a **saved** relief will carve differently, so the line is partial, as the auditor says.
  - The missing-font open notice (#1595) is not mentioned. Confirmed.
  - Correction: #1638 is **not a draft** (`isDraft: false`, state OPEN). The auditor called it "open draft".

### New findings

None.

### Not verified

- Rendered UI and the browser (no browser run). That includes whether the 1.0.29 RPM box was shown in a real session; its conditions were read (`DeviceSetupFoundMachine.tsx:46-56,143-177`).
- Production-nesting copies (X2-P1-1), read only.
- Other start routes against the converted-laser question (Start from line, external G-code run) were not checked.
- The app-wide router answer (the auditor's own Not-verified item) was not reproduced.
- A capsule sealed by 1.0.29 itself (X2-P2-1 used main's fixture).
- Hardware: none, by instruction.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x2r\`.

| File | What it does |
|---|---|
| `build.mjs`, `entry-*.ts`, `bundles\` | The bundles |
| `h.mjs` | Harness |
| `p11.mjs` | X2-P1-1 |
| `p12.mjs`, `p12fw.mjs` | X2-P1-2 |
| `mut\src\ui\laser\zz-x2r-recovery.test.ts`, `vt-recovery.txt`, `out\recovery.json` | X2-P2-1 |
| `p3.mjs`, `p33.mjs`, `p33b.mjs` | P3s |
| `clean.mjs`, `toast.mjs` | Byte identity |
| `pr1638.diff` | #1638's diff |
| `out\` | Files 1.0.29 saved |

`mut\` is a scratch copy whose `node_modules` is a junction. Remove the junction with `cmd /c rmdir` first.

Refuter counts: raised 6, refuted 0, P1 2, P2 1, P3 3, known 1
