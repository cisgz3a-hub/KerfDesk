# Audit of the last 200 pull requests (#1720–#1919)

**Asked:** "audit my last 200 PRs and make sure they are correct" (maintainer, 2026-11-14).
**Read at:** `origin/main` 53393cc16 (2026-11-14). Every finding below was checked against that commit, so a defect a later PR already fixed is not listed.

## Result

- **200 PRs:** 196 merged, 4 closed unmerged.
- **Did the merged work land intact?** Yes.
  - All 196 merge commits are ancestors of `main`.
  - Nothing was reverted, and no conflict markers are left in the tree.
  - The ADR number gate passes: 587 decisions and 541 amendments, all unique.
  - No `.only` tests and no leftover `zz-*` temporary files.
- **CI at merge:** every merged PR passed all five required checks on its last commit.
  - The only red check was `main-is-green` on 21 PRs (#1829–#1898). That check reports `main`'s health (ADR-710), not the PR's.
  - The "Fix main" PRs in the same window turned `main` green again.
  - `main` is green now: CI, the desktop package check and Main is green all pass on 53393cc16.
- **Closed PRs:** all four were deliberate.
  - #1806 was a diagnostic and was never meant to merge.
  - #1807 was replaced by #1808.
  - #1834 was replaced by #1835. #1835's merge added nothing, because its test change was already on `main`.
  - #1780 was the maintainer's decision. Its report still read as fixed; this PR corrects that.
- **Correctness review:**
  - The 126 PRs that change product code (about 43,000 lines) were read diff by diff in five batches.
  - The 10 PRs that change only tests or CI were read separately.
  - For the 60 docs-only PRs, every PR number their ledgers cite was checked against GitHub.
- **Outcome:** 3 P1/P2 burn or motion defects, 3 more P2s and 3 P3s were confirmed. The PR that adds this ledger fixes 8 of them; 1 P3 stays open, along with 2 unverified leads.

## Confirmed and fixed in this PR

| # | From PR | Severity | Defect | Fix |
| --- | --- | --- | --- | --- |
| 1 | #1762 (ADR-127 Amd 5–9) | **P1** | Ruida `.rd` on a Y-port rotary dropped the first burned edge of a layer that started where the previous layer ended. `planRdMotion` carries the head across layers and writes no travel there, so the part opened with a cut, and `classifyPart` treated that cut as a bare position. Example: two layers on the same closed square, score then cut; the cut layer lost one whole edge (20 mm in the test). | `classifyPart` starts from where the plan left the head. Test: `rd-rotary-feed.test.ts` (fails on `main`, missing 19,998 µm). |
| 2 | #1757 (with #1763, #1823) | P2 | On a tapered rotary, a Fill on a K40 (`.egv` or USB) or a Moshiboard burned each curved hatch row as a straight chord. Only the G-code Fill read the row's interior points (`span.via`, ADR-694 Amd 1). | Both planners burn through `span.via`. Tests: `lhy-fill-curved-row.test.ts`, `moshi-fill-curved-row.test.ts` (both fail on `main`). |
| 3 | #1723 (ADR-705) | P2 | A Moshiboard job ignored the machine origin. The job is already in machine coordinates for the profile's origin, but the board's frame is fixed at rear-left. A Front-left origin (the default profile's, and choosable in Machine Setup) burned the design mirrored front to back, and the Frame traced the same mirrored footprint. | Refuse any origin but rear-left, as the K40 route does (`emit-egv.ts`). Test: `emit-moshi-rotary.test.ts`. The three Moshi tests that ran on the default front-left origin now set rear-left. |
| 4 | #1725 (ADR-704) | P2 | The galvo list wait counted its 3,000 polls while the operator had paused. A pause longer than about 30 s, with lists still to send, aborted the job ("never reported Ready"). | Only reads of the board count towards the limit. Test: `lmc-run.test.ts` (fails on `main`). |
| 5 | #1889 (ADR-258 Amd 5) | P2 | A CNC profile layer with a finish allowance dropped every tab-hold finding (`never-through`, `fewer-tabs`, …). A hole whose slug never cut free gave no Job Review warning, which is the J1-P1-1 case Amendment 5 set out to name. | The allowance route returns the roughing rings' findings. Test: `compile-cnc-tab-holds.test.ts` (fails on `main`). |
| 6 | #1745 (ADR-127 Amd 4) | P3 | The old-project rotary notice read the raw layer speed against the Max feed. The compiler caps that speed both before and after, so a layer stored above the Max feed reported a change that did not happen (for example, 1.50× for lines along X). | `min(speed, Max feed)`. Test: `old-project-rotary-feed.test.ts`. |
| 7 | #1836 (ADR-703 Amd 2) | P3 | The K40 Rotary Setup note said "nothing runs slower than 23.5 mm/min" for every board. On A, B, B1 and B2 boards the slowest speed is about 47 mm/min (`lhySlowestMmPerSec`). The export's own dose note was already right. | The note names both figures. |
| 8 | #1782 (O1 barcode report) | P3 | The report said "fixed in #1780", but #1780 was closed unmerged. | A status note at the top of the report. |

## Open (not changed here)

| From PR | Severity | Item | Why it is open |
| --- | --- | --- | --- |
| #1892 (ADR-258 Amd 6) | P3 | Production Nest writes the stock thickness the operator types but never marks it set (`thicknessSet`). A typed 6.35 mm, the shipped default, therefore still reads as "never set". Other values already count as set. | The nest form starts from the project's stock, so marking every value set would also mark an untouched default. The form needs to know whether the field was edited. That is a small UI change, but it needs a decision on what counts as an edit. |
| #1725 (ADR-704) | P2, unverified | The galvo job encoder writes no jump delay; only the red-light Frame sets one, at 1 µs. If the board keeps that register between programs, marks could start while the mirrors are still settling. | Not checked against MeerK40t's balor source (the web fetch was blocked) or on hardware. The galvo route is experimental and simulator-tested only. |
| #1725 (ADR-704) | unverified | A list whose marks take more than 30 s would also hit the Ready limit without any pause. | It depends on how the board's Ready bit buffers lists, which has not been checked. |

## Leads dropped (not substantiated)

- **#1753, Ruida "4 idle reads without busy":** this could end a job early on a controller that starts more than 1.2 s after taking the file. There is no evidence that happens.
- **#1910, `'stop-cleanup'`:** the app-close warning checks only `'stop'` and `'fire'`, so it no longer warns. The reset itself is proven, so this is not unsafe.
- **#1724, K40 speed codes:** the comment names `fix_limit` but no >240 mm/s clamp exists. The profile's Max feed is 140 mm/s, so nothing can reach it.

## How each batch was read

Five read-only reviewers each read one batch's production diffs (`git diff <first parent> <merge>`) and the ADR the PR claimed. They traced each candidate to a concrete wrong output, and kept only defects still on `main`. Every finding in the tables above was then re-traced by hand. Each fix was shown to fail its test on `main` and pass with the change, except finding 6, which is a one-line clamp, and finding 7, which is text.

| Batch | PRs | Production lines | Verdict |
| --- | --- | --- | --- |
| 1 | #1720, #1723–#1726 (Moshi, K40, JCZ galvo, CH341, trace) | 9,140 | #1723, #1725 findings |
| 2 | #1729–#1754 (20) | 8,668 | #1745 P3 |
| 3 | #1756–#1823 (43) | 8,280 | #1762 P1, #1757 P2 |
| 4 | #1827–#1885 (37) | 9,801 | #1836 P3 |
| 5 | #1887–#1918 (21) | 7,029 | #1889 P2, #1892 P3 |

Parts read only in outline, which a deeper pass could still cover:
- the Photo Test Card UI (#1866);
- the tile-plan rewrite (#1885);
- relief reach morphology (#1878, #1904, #1909);
- tab placement scoring (#1889, #1903, #1907);
- CI workflow YAML (#1871);
- the galvo link and `.cor` parser (#1725).
