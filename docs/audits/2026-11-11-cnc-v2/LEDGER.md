# CNC audit v2 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Started
2026-11-11, when the user asked to "deep audit my cnc side for example my vcarve and all the math
etc behind it and then the rest of the bits". Earlier round: [../2026-10-23-cnc-v1/LEDGER.md](../2026-10-23-cnc-v1/LEDGER.md).

This round ran in one session with an independent G-code oracle and no separate refuter. Findings
carry the verdict `AUDITOR-REPRO` until a refuter confirms them.

| # | Area | Tree | Report | Raised | P1 | P2 | P3 | Known |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| J1 | V-carve maths, bits, 2D operations | a1518de75 | [J1-cnc-oracle-sweep.md](J1-cnc-oracle-sweep.md) | 5 | 1 (KNOWN K-4, re-rated) | 1 | 3 | 2 |

## Findings

| ID | Summary | Evidence | Fix status |
| --- | --- | --- | --- |
| J1-P1-1 | With default tabs, any hole under about 15 mm (or part under about 8 mm) that shares a layer with a larger shape stops at the tab top instead of cutting through, and Job Review says nothing (8 and 12 mm holes at 4.35 of 6.35 mm). KNOWN since 2026-09-24 as K-4 / TP-5 / AUDIT A5; re-rated P1 under METHOD §3 | AUDITOR-REPRO: `cnc-full-tab-coverage-warnings.ts:76-78` fires only when the whole layer is covered | open — refuter owed, fix proposed |
| J1-P2-1 | A V-carve that reaches exactly the stock bottom raises no warning; default 6.35 mm stock and the starter 12.7 mm 90° V-bit land there on any stroke 12.7 mm wide. Relief warns in the same case | AUDITOR-REPRO: `cnc-compiled-depth-warnings.ts:118-121`, `warnAtStockBottom` set for relief only | open — fix proposed |
| J1-P3-1 | A fully tabbed contour is re-cut at the tab top once per deeper level | AUDITOR-REPRO | open |
| J1-P3-2 | The tapered inlay's "Radial fit gap" seats the plug deeper instead of leaving a gap; the real glue gap is 0.42 mm for a nominal 0.5, and a gap over glue·tan leaves an unreported seam | AUDITOR-REPRO | open — wording and one note |
| J1-P3-3 | Real 6.35 mm stock reads as never set, so the tab warning's "Set Stock thickness" cannot be followed | AUDITOR-REPRO | maintainer decision (changes what a saved thickness means) |

## Verified clean

18 V-carve programs (no gouge over 0.0002 mm; stock left equals the documented floor scallop), 2
tapered inlay pairs (wall gap at most 0.010 mm), and 25 profile, pocket and drill programs (no kept
material cut, no over-depth, no rapid into uncut stock). Details and the not-verified list are in
the report.
