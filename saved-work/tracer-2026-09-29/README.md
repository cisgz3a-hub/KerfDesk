# Saved tracer work, 29 September 2026

Patch files only. Do not merge this branch.

The tracer audit's follow-up work was built after #896 merged and was paused on 29 September 2026
before it was pushed. Its commits sit on the tracer branch from before the licence change (#1022),
so they are stored here as patch files on top of current main instead of as a branch.

The verdicts come from the 29 September jobs review, which compared each package with main at
`2f6f84dec` and with draft #989.

| Folder | Holds | Base commit | Verdict |
|---|---|---|---|
| `1-centerline` | 4 commits (ADR-394, audit F7): even-width Centerline strokes trace on their centre, a bend drawn round in a thick stroke stays round, a zero join gap bridges nothing. | `e90d52822` | Keep. Still open on main and in #989. Re-apply after #989 settles, because #989 rewrites `distance-field.ts`, `medial-thinning.ts` and `erosion-queue.ts`. |
| `2-trace-dialog` | 14 commits (ADR-396): the trace reports the automatic threshold it chose and the dialog shows it, Manual starts from that value, a Centerline Join gaps control, hint and wording fixes, Alt+T, an Edge Detection stroke preview, and the WORKFLOW.md steps. | `5d4bafa16` | Keep about half: the threshold display, Manual starting from it, Join gaps and the wording fixes. Drop Alt+T and the Edge stroke preview, which #924 put on main. Most of the code needs rewriting for the restructured dialog. |
| `3-settings-engine` | 2 commits (ADR-395, audit F9): Optimize 0 keeps every traced point, Smoothness sets how many corners an outline keeps. `uncommitted.diff` is the unfinished rest, on top of those two commits: the automatic threshold module, a spline envelope, the ink report and the draft ADR-395. | `85ee406d4` | Drop unless #989 is abandoned: its ADR-439, 530 and 533 cover this. Optimize 0 still merging points is open in both (low). |
| `4-specks-cracks` | 8 commits (ADR-392, audit F2 and F6): pixels that touch at a corner count as one mark, only grey cracks are filled, and a 2 px² speck default. | `e90d52822` | Drop: ADR-403, 434 and 455 on main cover it. Filling only grey cracks is still open for Centerline and Line + fill. |
| `5-edge-placement` | `uncommitted.diff` only, barely started: sub-pixel edge crossings for brightness bands (a draft ADR-393). | `85ee406d4` | Drop: redo it on #989's edge placement hook (ADR-533). |
| `6-multi-file-trace` | `uncommitted.diff` only: saving from Multi-File Trace. | `2-trace-dialog` applied (its tip was `4ab8dd1ee`, never pushed) | Drop: #1002 fixed it. |

The base commits live on the `claude/tracer-audit-dwqt3x` branch (#896), so keep that branch until
this work is ported or dropped. The ADR numbers inside the patches (392 to 396) now belong to other
decisions on main; take new ones from `node scripts/check-adr-numbers.mjs`.

To see a package as it was, from a checkout of this branch:

```sh
git fetch origin claude/tracer-audit-dwqt3x
git worktree add ../tracer-old e90d52822
git -C ../tracer-old am "$PWD"/saved-work/tracer-2026-09-29/1-centerline/*.patch
```

Apply an `uncommitted.diff` with `git apply` after its folder's patches.

Porting any of this to current main is a rewrite rather than a rebase: main has changed about
29,000 lines of tracing code since these were written. Re-measure each finding on main first.
