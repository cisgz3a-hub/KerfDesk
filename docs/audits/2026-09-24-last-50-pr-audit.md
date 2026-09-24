# Audit of the last 50 PRs (#817-#866), 2026-09-24

Scope: every PR numbered #817-#866. 40 are merged, 10 are open. The questions were whether
any PR broke the system, whether the merges fit together, whether everything merged is
live on kerfdesk.com, and whether each change is correct.

Baseline: `main` at `025dc9b8d` (#840), checked 2026-09-23 23:32Z to 2026-09-24 00:10Z.

## Result

- **No merged PR leaves a defect on `main`.** Three PRs shipped with defects that later
  PRs in the same window fixed: #817 (burn tail glowed during laser-off travel; fixed by
  #826), #818 (its gate fix landed first through #826; #818 only added the comment) and
  #829 (a resumed raster ran dark mid-row, air assist was not restored, and sweep
  boundaries were wrong; fixed by #835, #836 and #860).
- **The merges are in sync.** All 40 squash commits are on `main`, and each contains
  exactly its PR's files. #818 is the one expected exception, explained below. Nothing
  was reverted. The main CI and Browser smoke runs are green at `025dc9b8d`.
- **Everything merged is live.** kerfdesk.com and `laserforge-2fj.pages.dev` serve the
  same entry, `assets/index-jlTVQe1Y.js`, which is stamped `Commit 025dc9b8` and built
  2026-09-23T21:06Z. `cf-cache-status` is `DYNAMIC`, and the service worker precaches
  that entry. Deploy run 35928026121 recorded its **Publish** step as `success`.
- **Rule 7 holds.** None of the 40 merged PRs adds a Start policy gate. #860's
  handoff refusal is a handoff-consistency refusal; it waits two seconds first, and
  unavailable storage never blocks. #835 refuses only output it cannot produce
  (a painted pass from a Marlin or Smoothieware program).

## Method

1. For each merged PR, `git merge-base --is-ancestor <squash> origin/main`, then a
   comparison of the PR's file list (GitHub API) with the files in its squash commit.
2. `statusCheckRollup` on each PR's final head. All 40 have Chrome UX smoke,
   Lint/typecheck/license/test/build and CodeRabbit at `SUCCESS`.
3. Every workflow run on `main` since 2026-09-20. Each failure was read from its log
   (see below).
4. **Revert scan.** Every line each squash commit deleted was blamed in its parent. A
   deletion attributed to another PR in the window was checked by hand: #847 against
   #854, #830 against #822, #860 against #842, #840 against #832, #834, #839 and #854,
   #854 against #817, and #826 against #816. None is a silent revert.
5. Code review of every merged PR's production diff, weighted toward motion, output,
   serial, recovery, Frame and Start. User-interface-only diffs got a lighter review.
6. A rule 7 scan of added refusal and blocker code in all 40 PRs.
7. **Live check.** The kerfdesk.com entry plus 104 lazy chunks were fetched, and up to
   three prose strings added by each PR were searched for. The only absent strings were
   ones a later PR removed (#822's machine filter, removed by #830) or ones in code that
   never ships (below).
8. **Reachability.** A production import graph was built from `index.html`, including
   worker `new URL(...)` targets. Every window-touched source file that the graph does
   not reach was listed.

## Failed runs on `main` in the window

| Run | Commit | Cause | Status |
| --- | --- | --- | --- |
| CI 35548939263 | 7ef578b52 (#817) | `verify-packaged-preview-metadata` read an asar archive before it was flushed | Fixed by #819; CI green afterwards |
| Browser smoke 35725409062 | dff35227e (#831) | `e2e/paged-asset-worker.e2e.ts` cancellation race | Flake, seen once. The code under test has no production caller; see follow-ups |
| Packaged desktop native smoke 35846466381 | 90c791c5f | Save As moved into More (#797) | Fixed by #861; manual run on 9b6180499 passed; re-run on 025dc9b8d dispatched (35936683602) |
| Coverage trend (weekly) | 9b741e210 and earlier | `design-scene-connected-script.test.ts:247` has a 45 s bound, and the test takes about 73 s under coverage | Before this window (test added in #641); see follow-ups |

## Merged PRs

| PR | Squash | Change | Verdict |
| --- | --- | --- | --- |
| #817 | 7ef578b52 | Burn progress scorch and ember | Correct. The tail showed during travel until #826 |
| #818 | 4f1a33bc3 | Release motors gate predicate | Correct. #826 landed the fix and its test first; the squash is the comment. `OriginRow.tsx:198` and `NoHomingPositionGuide.tsx:53` both use the XY predicate |
| #819 | 95b55b0d0 | asar flush race in packaging script | Correct |
| #820 | 377e692ba | Bend scan by index | Correct. `arcTrimIndex`/`chordAnchorIn` are equivalent to the slicing version. #826 corrected one comment |
| #821 | 288ad66ba | Light theme, copper chrome | Correct |
| #822 | af1a1b83f | Lesson fidelity; Escape leaves one level | Correct. Its ADR-324 amendment is partly superseded by #830 (noted in this PR) |
| #823 | 9d72ba798 | Machine Setup in three stages | Correct. The firmware comparison still renders and opens when writes are queued |
| #824 | 692c6f1be | Dense Sharp fill; one Frame preparation at a time | Correct |
| #825 | 6c7a5b1ea | Import Image on the toolbar | Correct |
| #826 | 39eebb6fc | Codex fixes for the Claude PR audit | Correct |
| #827 | a3f4da41d | Artwork settings; CNC material and bit | Correct. Reuses Startup Setup's transform |
| #828 | e774f79a5 | Workspace controls; Done after a job | Correct. Done clears only the run display |
| #829 | c0272ad25 | Interrupted-job recovery and painted second passes | Shipped with defects, fixed by #835, #836 and #860. The writer and resume transform on `main` are verified |
| #830 | 3a333acb7 | Simpler tutorials | Correct. One-level Escape is kept |
| #831 | dff35227e | Deploy publishes a commit still on `main` | Correct, and proven in production |
| #832 | b2f829c29 | Machine coordinates and origin preparation | Correct. Verified: program = bed - (WCO + native-to-bed offset), only when the mapping is known |
| #833 | 4636d26e6 | Last-100 audit defects | Correct. Serial framing discards through the next newline |
| #834 | 707d61938 | Frame progress; immediate status query | Correct |
| #835 | 00ca766e1 | Second pass names unsupported families | Correct and rule 7 compliant |
| #836 | 906e6c818 | Sweep boundaries and beam-mode economy | Correct. Its amendment was appended to the frozen `DECISIONS.md` (moved in this PR) |
| #837 | e9b63686a | Scan direction on the card | Correct |
| #838 | ee50146a5 | One decision per file (ADR-344) | Correct |
| #839 | 59646dad7 | Dense-job preparation 2.6x faster | Correct. The Job Review reuse key covers output scope, placement and controller inputs |
| #840 | 025dc9b8d | Split Frame (ADR-353) | Correct. The traced bounds use the same functions as Start's gate, and #854's edit survived the function move |
| #841 | 721264fc2 | Artwork sprites; packed project transfer | Correct. The packing is lossless for every field |
| #842 | 0a24d8765 | Recovery stress suites | Correct. #860 moved these tests without losing any |
| #843 | 83c3dc777 | Automatic setup lane; profile cards | Correct |
| #844 | 90c791c5f | Workspace chrome pass (ADR-348) | Correct. The squash subject says ADR-346 (cosmetic) |
| #845 | c06fcdaa2 | Withdraw the hardware claim from docs | Correct |
| #846 | 04252e8a6 | CNC runway on the program's own representation | Correct |
| #847 | 5eaa9d483 | Artwork workflows (ADR-350/351) | Correct for everything that affects output. Overlap removal is opt-in and exact, and closed contours carry their closing point |
| #849 | 57a5a55a7 | Photo shading trace | Correct. The coverage rasterizer runs only for this preset |
| #853 | dd4488d13 | KerfDesk in operator copy | Correct. No persisted identifier was renamed |
| #854 | 5e4d8def4 | Responsive while a big job streams (ADR-352) | Correct. The Start fence counts store and ledger writes, and the ack batch always makes progress |
| #855 | 52ab71f2f | Hardware-status wording | Correct |
| #857 | 97a721141 | Falcon evidence wording in comments | Correct |
| #860 | e875fe290 | Resume and painted-pass fidelity (ADR-341 Amd 3) | Correct |
| #861 | 9b6180499 | Packaged smoke reaches Save As | Correct |
| #862 | 1e4a9a1f6 | Serial read slicing; watchdogs (ADR-356) | Correct |
| #863 | e461557e4 | One store write per serial chunk (ADR-352 Amd 1) | Correct |

## Open PRs (state at 2026-09-24 00:09Z)

These belong to other sessions. "PR reviews and fixes" owns most of them;
"Machine processing bottleneck" holds #850, #852 and #858; "Fine lines burn quality
issue" owns #864. This audit made no changes to them.

| PR | State |
| --- | --- |
| #848 | Green, mergeable |
| #850 | CI running |
| #851 | Green, mergeable. Claims ADR-354, which ADR-356 on `main` already cites |
| #852 | CI running |
| #856 | Green, mergeable |
| #858 | Chrome smoke failed on the current head; CI running |
| #859 | CI running |
| #864 | Rebased after its ADR-350 collision with #847; CI running |
| #865 | Draft, green |
| #866 | CI running. Hardens #861 rather than fixing a live failure |

## Fixed in this PR

- **ADR-341 Amendment 1** was appended to the frozen `DECISIONS.md` by #836, 25 minutes
  after ADR-344 froze it. ADR-344 gives a new amendment section its own file. The text
  moved verbatim to `docs/decisions/ADR-341-amendment-1-sweep-boundaries-and-beam-mode-economy.md`,
  which sits beside Amendments 2 and 3, and ADR-341 now points to all three.
- **ADR-324 Amendment (#822)** still read as current for the "Learn next" links and the
  machine-filter count that #830 removed. It now says which decisions were superseded
  and which still hold.

## Follow-ups outside this window (filed as separate tasks)

- The weekly **Coverage trend** fails on a wall-clock bound that coverage
  instrumentation exceeds.
- **Dead code:** `src/core/job/planner.ts` (no production caller since #799),
  `MachineSetupProfiles.tsx` -> `DeviceSettings.tsx` -> `HomingEditor` (never imported
  by the app), and `paged-asset-worker-client.ts` (no production caller; its e2e is the
  flake above). #832's edits to `planner.ts` and `HomingEditor` therefore never reached
  users.
- **Latent, unreachable today.** The resume word parser (`WORD_RE` in
  `laser-resume-reentry.ts` and `resume-program.ts`, from #196) does not read
  leading-dot numbers such as `X.5`. KerfDesk always emits a leading zero, and imported
  G-code is preview-only, so no resumed program contains one.

## Not verified

- No hardware was operated. Motion, laser and serial behavior is verified in code and
  tests only.
- User-interface-only diffs (#823, #827, #828, #843, #844 and the UI half of #847) were
  reviewed for state and logic, not for visual design.
