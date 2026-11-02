# Rolling audit v9 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| R7 | Returning user: older projects on main | origin/main @ e617025eb (refuter 945aa837b; same counts) | [R7-returning-user.md](R7-returning-user.md) | 5 | 0 | 1 | 2 | 2 | 2 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| R7-P1-1 | R7 | **A single-line framed project saved by 1.0.27, then opened and saved on 1.0.28, keeps the shrunken size for good.** "ANNA" in a Relief 80 × 11 mm frame burns 29.612 × 7.480 mm instead of 39.588 × 10.000 while the canvas shows the 11 mm template, with no warning; the worst record shrinks to 66.1 % and 14 records change line breaks. Not new on main: 1.0.28 burns the same size even on a direct open, so this is the #1507 harm that shipped, which #1523 cannot reach. ADR-682 Amd 1 accepts it ("the file does not record which text step 18 converted") but puts no warning in front of the operator. Comparing stored geometry with a re-render does tell them apart: 0 false fires on 360 frames, 140 records byte-identical to a direct open; 11 of 72 converted frames look the same under both rules, and 3 of those still burn wrong | **READ** (main): `migrate-v18-single-line-text-em.ts:49` sets `legacyLineEm` only in step 18; schema-19 files skip it; ADR-682 Amd 1 lines 47-48. Auditor + refuter REPRO (saved by each release's real code) | fix card proposed |
| R7-P2-1 | R7 | **Variable records in older projects move with no notice**: up to 38.602 mm in a bend, 1.7 mm on a path, 4.544 mm in a frame (1.0.27 files; 2.272 mm for 1.0.28 files). Intended, and the new place is on the canvas anchor, so P2, but a batch placed on real blanks lands elsewhere. A record that wraps to more lines also moves, and one Casual Hand name ends 1.883 mm below the frame bottom | **READ** (main): `render-variable-text.ts:14-28,87`, `text-box-render.ts:95`; no notice in `project-open-completion.ts:47-52` or `project-load-notices.ts`. Auditor + refuter REPRO | fix card proposed |
| R7-P2-2 | R7 | **Image dose changes are announced only in 1.0.28's update notes**: Grayscale with Dot Width burns +41 % (+65.7 % on a plain gradient), turned Pass-Through +38 %. Notes are one file per version, so someone skipping 1.0.28 never sees them; reachable once the next release exists | **READ** (main): `electron/manual-update-notes.ts:28`, `docs/releases/desktop-update-notes.json`, ADR-458 Amd 1 Consequences. Auditor + refuter REPRO | fix card proposed |
