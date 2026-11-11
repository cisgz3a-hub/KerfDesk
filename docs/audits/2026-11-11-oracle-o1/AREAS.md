# Oracle audit O1 — areas and method

**Requested by** the maintainer on 2026-11-11: "design your own thinking of auditing and go and audit and delegate different areas in my repo. You can verify audits with research. Start loops to do these audits in batches."

## Why a new kind of audit

More than fifty audits already sit in `docs/audits/`. Most of them ask one question: *does the code do what the code, the tests and the ADRs say it should?* Rolling v2–v14, C1/C2, A1/A2 and the CNC rounds all check KerfDesk against KerfDesk. That catches regressions and drift, but it inherits every assumption the code was built on. If an emitter writes a number in a form no controller accepts, or a QR encoder picks the wrong mask, the code, the test and the ADR can all agree and all be wrong.

O1 checks KerfDesk against **the outside world**. Every area starts from an *oracle*: something that knows the right answer and was not written by this project.

| Oracle kind | Example |
|---|---|
| **Published standard** | ISO/IEC 18004 (QR), ISO/IEC 16022 (Data Matrix), GS1 General Specifications, the AutoCAD DXF Reference, TIFF 6.0, the OpenType spec, NIST RS274/NGC, IEC 61966-2-1 (sRGB) |
| **Independent implementation** | a decoder that did not write the code (decode every generated barcode), a reference algorithm the auditor writes from the paper, not from our source |
| **Mathematical property** | round trip (`import(export(x)) == x`), idempotence, conservation (area, length, count), no overlap, symmetry |
| **Vendor or competitor behaviour** | LightBurn, xTool and controller documentation, Paddle and Electron docs: what users already expect |

And it targets the code the earlier audits barely touched. A count of mentions of each subsystem in every audit since 2026-10-21 put these at the bottom: nesting (1), the auto-updater (1), PSD (1), barcodes (2), vector export (2), STL (2), boxes (3), variables (3), HPGL (3), image adjust (4), parts (4), TIFF (5), sketch constraints (6), material library (7), licensing (8). Rotary, camera, controllers, the project file and the G-code emitters have been audited ten to thirty times each and are left out unless an oracle says otherwise.

## Method (each area)

Each area runs in its own Claude session, which owns the whole loop through to merged pull requests.

1. **Oracle plan first.** Before reading the implementation closely, write down the claims the area must satisfy and the oracle for each one (a standard and section, a reference implementation, a property, a vendor page). Writing the oracle before reading the code keeps the audit from adopting the code's own assumptions.
2. **Auditor** (subagent). Test every claim against its oracle on current `origin/main`. Every finding has a reproduction: a script or test run on the real modules, with its input and output.
3. **Refuter** (fresh subagent, a different method). Tries to break each finding and each "verified clean" claim: a second reproduction, a different input generator, a different reading of the standard.
4. **Research verifier** (fresh subagent with web access). For every finding and every clean claim that rests on an outside fact, fetch the primary source again and mark it:
   - **VERIFIED**: the source says what the report says (quote at most one short line, give the section or URL);
   - **CONTRADICTED**: the source says otherwise; the finding is dropped or rewritten;
   - **UNSOURCED**: no primary source found; the finding cannot be P1 and the report says "not verified".
   Secondary sources (forums, blog posts, AI answers) never count as primary. A competitor's behaviour counts only from its own documentation or a reproduction.
5. **Owner re-check.** The session re-reads every P1 and P2 in `origin/main`'s code and states the commit it read.
6. **Report** `O<n>-<area-id>.md` in this folder, in a docs pull request that touches only that file. Sections: Headline, Oracle plan, Findings (`O<n>-P<k>-<m>`, each with reproduction, oracle, research verdict and refuter verdict), Refuted, Verified clean, Not verified.
7. **Fix** every confirmed P1 and P2, and the cheap P3s, in fix pull requests branched fresh from `origin/main`, each with a regression test that fails before the fix. A change in documented behaviour gets an ADR amendment, or a new ADR numbered after checking open pull requests too (`node scripts/check-adr-numbers.mjs`). Anything that would move a toolpath or change what users see and is **not** a confirmed P1/P2 is listed for the maintainer instead.
8. **Done** means every pull request is merged with green CI (auto-merge, MERGE method, plus Auto-fix).

The coordinator (the session that wrote this file) writes [LEDGER.md](LEDGER.md), re-checks each P1 against its primary source, and starts the next batch.

## Severity

As rolling v2 METHOD §3 (P1 has no reach clause), with two additions for this audit:

| Level | Meaning |
|---|---|
| **P1** | Wrong physical output (power, position, depth, scale); **or a mark that silently carries the wrong content or cannot be read** (a barcode that decodes to other data or does not decode at its stated size); loses or corrupts user data; a paying user locked out of what they paid for, or a remotely reachable licence or payment bypass; a file KerfDesk writes that other software reads as different geometry. |
| **P2** | A standard or vendor contract broken in a way an ordinary user will hit, with a misleading result; a security weakness that needs local access or unusual conditions. |
| **P3** | Latent, drift, a missing test, polish. A deviation from a standard that no realistic input reaches. |

A finding whose oracle is UNSOURCED is capped at P2.

## Areas and batches

Finding IDs are `O<area>-P<n>-<k>`. Three areas run at a time.

| # | Area id | Scope | Question | Oracle |
|---|---|---|---|---|
| **Batch 1** | | | | |
| O1 | `barcode-truth` | `src/core/barcode/` and the barcode tool UI | Does every symbology encode exactly the user's data, decode with an independent reader at the stated size, and keep its quiet zone after a laser burn? | ISO/IEC 18004, 16022, 15417 (Code 128), 16388 (Code 39), GS1 General Specifications (EAN/UPC, check digits, X-dimension), an independent decoder |
| O2 | `file-format-truth` | `src/io/dxf`, `hpgl`, `stl`, `tiff`, `psd`, `pnm`, `vector-formats`, `src/core/vector-export` | Do imports read what the format says, and do exports read back as the same geometry in other software? | AutoCAD DXF Reference, HP-GL/2 reference, TIFF 6.0, Adobe PSD file format spec, PDF 1.7 (ISO 32000-1), EPS/DSC, round-trip properties |
| O3 | `licensing-and-update-trust` | `services/desktop-licensing/`, `electron/licensing-*`, `electron/auto-update.ts`, `electron/commercial-update*.ts` | Can a paying user lose access, can a refund or chargeback be missed, can an update be downgraded or replayed? | ADR-540/592/623, Paddle Billing webhook and adjustment docs, electron-updater docs, Cloudflare Workers docs. **Trust boundary: security findings stay redacted in public text until fixed.** |
| **Batch 2** | | | | |
| O4 | `nesting-box-geometry` | `src/core/nesting/`, `src/core/box/`, `src/core/parts/` | Do nested parts never overlap or leave the sheet, and do generated boxes fit after kerf? | geometric invariants (no overlap, clearance ≥ spacing, area conserved), published finger-joint kerf rules (boxes.py, MakerCase documentation), a fit-coupon calculation by hand |
| O5 | `variables-and-batch-production` | `src/core/variables/`, batch and CSV merge paths | Can a production run repeat or skip a serial, or print the wrong date? | LightBurn variable text documentation, Unicode LDML date patterns, time-zone and DST rules, RFC 4180 (CSV) |
| O6 | `image-maths-truth` | `src/core/raster/`, `image-adjust/`, `image-edit/`, dithering | Do dithers, gamma and tone curves match their published definitions? | the original papers (Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Atkinson, Bayer), IEC 61966-2-1, an independent reference implementation |
| **Batch 3** | | | | |
| O7 | `text-and-font-truth` | `src/core/text/` | Is shaped text placed where the font says (kerning, bidi, combining marks, text on path, single-line fonts)? | OpenType spec, Unicode UAX #9 (bidi) and #24 (scripts), HarfBuzz behaviour as reference |
| O8 | `units-locale-numbers` | every number crossing a boundary: G-code and file writers, inputs, imports | Can a number be written in a form a controller or another program misreads (exponent, locale comma, rounding drift, mm/in, mm/min vs mm/s, % vs S)? | NIST RS274/NGC, GRBL/grblHAL/Marlin/FluidNC docs, LightBurn unit conventions, IEEE 754 |
| O9 | `material-library-truth` | `src/core/material-library/`, `src/io/material-library/` | Do imported and shipped presets carry the right power, speed and units, including LightBurn `.clb`? | LightBurn library documentation, controller S-value ranges, vendor material charts |
| **Batch 4** | | | | |
| O10 | `sketch-and-design-carve` | `src/core/sketch-constraints/`, `src/core/design-carve/`, `src/core/shapes/` | Do constraints solve to the exact dimensions typed, and fail loudly when over-constrained? | geometry by hand, conservation properties, degenerate-case catalogue |
| O11 | `supply-chain-truth` | `package.json`, `pnpm-lock.yaml`, `patches/`, `THIRD_PARTY_NOTICES.md`, bundled fonts and assets | Is every shipped dependency, font and asset licensed for a closed paid app, listed, and free of known advisories? | each package's own licence text, GitHub/OSV advisories, font licences (OFL) |
| O12 | `research-reverify` | the ledgers of C2, A2, CNC v2 and rolling v14 | Do the outside facts those audits relied on (firmware behaviour, vendor docs, LightBurn behaviour) say what the audits claimed? | the primary sources they cited, fetched again (meta audit v1's method) |

## Rules for every area session

- Start from the latest `origin/main` (`git fetch origin`), in the session's own worktree. Never `git stash`; use WIP commits.
- **Safety:** simulated controllers and stub cameras only. Never hardware, a real serial or USB device, or a live external service (no real licence server, Paddle, update feed or email). Never build or package the desktop app or launch the installed KerfDesk.
- **This PC:** many sessions share it. Run targeted Vitest files only (`--maxWorkers=2`), never the whole suite or full lint; use `git grep`, not `grep -r`, over `src`. See the local-check notes in the session brief. CI (Node 22) is the authority.
- **Research:** primary sources only, cited by section or URL; at most one short quotation per source; never paste copyrighted text.
- **Pushes:** `LICENSE` must say "All rights reserved" before any push. Grep for conflict markers before committing. Each report PR touches only its own file; the coordinator alone edits `LEDGER.md`.

**Status:** started 2026-11-11. Batch 1 (O1–O3) running.
