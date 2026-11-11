# O1 `barcode-truth` — Oracle audit O1, batch 1

**Area:** `src/core/barcode/` (QR Code, Data Matrix, Code 128, Code 39, Code 93, Codabar, ITF, EAN-13/UPC-A/EAN-8, UPC-E, ISBN, Reed–Solomon, masks, module contours, layout, materialize) and the path from the barcode dialog to burned Fill geometry.
**Read at:** `origin/main` 5c9441ba8 (2026-11-11). Method, severity and rules: [AREAS.md](AREAS.md).
**Fix PR:** [#1780](https://github.com/cisgz3a-hub/KerfDesk/pull/1780) (O1-P2-1, O1-P3-1, O1-P3-2; ADR-386 Amendment 3).

## Headline

Every encoder is right. A decoder written from the standards, sharing no table or helper with KerfDesk, read back:

- 2,000 fuzzed QR Codes (all four levels, versions 1–40, numeric, alphanumeric, byte, UTF-8, emoji and control characters);
- every Data Matrix size from 10 × 10 to 144 × 144, plus 396 fuzzed Latin-1 strings;
- 3,000 fuzzed 1D codes across the nine linear symbologies;
- the engraved outlines of every symbology, normal and inverted.

Every one decoded to exactly the typed data, with the quiet zone clear (or fully burned when inverted). The refuter's different generators (exact capacity boundaries, segmentation DP optimality, pad paths, UPC-E expansions) found nothing either.

The weak point is the step after the geometry. A scanline Fill burns one line every line interval. When the interval is wider than a module, whole rows of modules are never burned and the code cannot scan, and nothing in KerfDesk said so. That is **O1-P2-1**, fixed by a Job Review warning in #1780.

| Raised | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 11 (9 auditor, 2 refuter) | 2 (1 refuted, 1 merged into another) | 1 (a code comment's claim) | 0 | 1 | 7 |

The Data Matrix 144 × 144 interleave is known and not re-raised (ADR-386 Amendment 2). New research on it is noted under Verified clean.

## Oracle plan

This plan was written before the code was read closely, after listing file names only.

| # | Claim | Oracle |
|---|---|---|
| Q1–Q11 | QR Code: Table 9 block structure; format BCH(15,5) with generator 0x537 and mask 0x5412; version BCH(18,6) with generator 0x1F25; the eight mask conditions and their penalty; mode indicators and count widths; terminator and 0xEC/0x11 pads; RS over GF(256) 0x11D with roots α⁰…; interleave; function patterns and Annex E alignment; byte-mode interpretation; 4X quiet zone | ISO/IEC 18004:2015 clauses 6.3.8, 7.4–7.10, Tables 3, 7, 9 and 10, Annex E, Annex I example; auditor's independent reader |
| D1–D5 | Data Matrix ECC 200: Table 7 sizes; RS over 0x12D with roots α¹…; ASCII encodation, Upper Shift and the 253-state pad; Annex F placement; 1X quiet zone | ISO/IEC 16022:2006 §5.2.3, §5.7, Table 7, Annex F; ISO example "123456" |
| C1–C4 | Code 128: patterns, mod-103 check, code-set choice, 10X quiet zone | ISO/IEC 15417:2007; auditor's transcribed table and its own shortest-encoding DP |
| K1–K4, N1, I1–I2 | Code 39 (patterns, 2–3:1 ratio, 10X); Code 93 (C and K mod 47, termination bar); ITF (even digit count, 10X); Codabar (A–D framing) | ISO/IEC 16388, AIM USS-93, ISO/IEC 16390, AIM USS-Codabar / EN 798 |
| E1–E7 | EAN/UPC: mod-10 3/1 check; EAN-13 parity; UPC-E expansion and parity; quiet zones 11/7, 9/9, 7/7, 9/7; X-dimension; ISBN-10 to 13 | GS1 General Specifications R26.0 §5.2, §5.12.3.1, §7.9.1 |
| L1–L5 | Laser: module-exact geometry; quiet zone kept, inverted marks burning it; module size against the layer's line interval and spot; escapes give the intended characters; bad data refused loudly, never altered | Geometric properties (vertices on the lattice, even-odd sampling, scanline coverage) through the real `fillHatching`; vendor docs (LightBurn barcode reference) |

The auditor's reader lives in scratch, outside the repo: `gf.ts`, `qr-oracle.ts`, `dm-oracle.ts` and `linear-oracle.ts`, about 900 lines. It imports nothing from KerfDesk. It checks every function module, both format copies, the version blocks, remainder bits, every RS syndrome, the pad sequences and the fixed Data Matrix corner, not only the decoded text.

## Findings

### O1-P2-1 — A barcode whose modules are narrower than its Fill line interval cannot scan, and nothing warns

**Where:** no check existed.
- `src/core/barcode/barcode-layout.ts` warns only below a 0.2 mm module, and only from the dialog's size, with no reference to the interval.
- `src/core/min-feature/operation-targets.ts` skips Fill operations.
- `src/ui/laser/machine-job-warnings.ts` had only the 144 × 144 Data Matrix barcode check.

**Reproduction (auditor):** `materializeBarcode`, then real `fillHatching` (angle 0, even-odd), at three placement phases. The probe counted dark modules that no scanline crosses, then read the result with the auditor's QR reader (burn width equal to the interval, more than 50 % ink per module).

| Module | Interval | Dark modules with no line | Decoded |
|---|---|---|---|
| 0.33 mm | 0.4 mm | 229 | 0/3 |
| 0.25 mm | 0.3 mm | 234 | 0/3 |
| 0.15 mm | 0.2 mm | 287 | 0/3 |
| 0.6 mm (default) | 0.1 mm (default) | 0 | 3/3 |

No warning appeared in any of the three failing cases.

**Refuter:** CONFIRMED with an independent harness (bed placement at 203.46/151.23 mm, Liang–Barsky module hit test).
- QR v2 at 0.25/0.3 left 57 of 324 dark modules unburned.
- QR v2 at 0.15/0.2 left 109 of 324.
- Data Matrix at 0.33/0.4 left 17 of 103.
- The count depends on the symbol and its phase; the failure does not.

The refuter also **widened** the finding. A 1D code is safe when the lines cross its bars, since each line keeps the bar edges exact. When every line runs *along* the bars (hatch at 90°, or the object turned 90°, with no cross-hatch), each bar's width is built from whole lines. An ISO/IEC 15417 edge-to-similar-edge decode then failed for Code 128 at 0.33 mm modules with 0.2 mm lines (deviation 0.53–0.56 against the 0.5 limit), which is below the module.

Nothing on `origin/main` caught it. Defaults are safe (0.1 mm interval; one shipped recipe uses 0.2 mm). It takes a coarser saved Fill default or recipe, a scaled-down code, or a small code in width mode (a 7 mm QR Code gives 0.21 mm modules).

**Oracle:** a geometric property (scanline sampling) and the reproduction. **Research:** no primary source sets a number of lines per module. The LightBurn barcode reference is silent. GS1 §5.12.3.7 and §5.12.4.3 point to ISO/IEC TR 29158, which gives contrast and cell-size rules but no line count. The finding does not rest on an outside number: above one module, rows get no line by construction. Severity **P2**: the user's own settings cause it, but the result is a mark that silently does not scan.

**Owner re-check:** re-read `barcode-layout.ts`, `operation-targets.ts`, `machine-job-warnings.ts` and `fill-hatching.ts` at 5c9441ba8.

**Fix:** [#1780](https://github.com/cisgz3a-hub/KerfDesk/pull/1780), ADR-386 Amendment 3. Job Review names each barcode on an output Fill (Follow Shape excluded) whose effective interval, per-object override included, is wider than:
- the placed module (dialog size × object scale) for matrix codes;
- half the placed module for 1D codes whose lines run along the bars with no cross-hatch.

It is a warning and never a refusal. The regression test burns a code through `fillHatching` and decodes it with the test QR reader: it reads at 0.6/0.1 and fails at 0.25/0.3. The test then pins the warning rules.

### O1-P3-1 — The Code 128 test reader imported the encoder's pattern table

`src/__fixtures__/barcode/linear-decoders.ts` imported `CODE128_WIDTHS` from the encoder, so a slip in that table would encode and "decode" consistently. The refuter CONFIRMED this. It is partly mitigated by a hand-typed module-string test and the PJJ123C check vector. The auditor's separately typed table matches the encoder's for all 106 values, so the encoder is right.

**Fixed in #1780:** the reader carries its own transcription, and a test asserts that the two agree.

### O1-P3-2 — `qr-mask.ts` called its rule-3 reading "the widely deployed reading"

**Claim:** the penalty for a finder-like 1:1:3:1:1 run counts only light modules inside the symbol, described as "the widely deployed reading of the rule".

**Research: CONTRADICTED as worded.**
- ZXing `MaskUtil.isWhiteHorizontal` returns false out of range, so it uses the same reading. KerfDesk's two ZXing reference symbols pin this.
- Nayuki's generator adds a light border to the runs, so it counts modules beyond the edge as light.
- The ISO text for §7.8.3 was not read.

The refuter thought ZXing clamps to the edge, but the research verifier quoted ZXing's source, and the primary source wins.

**Measured:** the two readings choose different masks in 877 of 2,000 auditor symbols and 111 of 200 refuter symbols. With the inside reading, KerfDesk's choice is minimal in 2,000/2,000 cases. Every forced mask decodes (160/160).

**Fixed in #1780:** comment only. No mask choice changed.

### O1-P3-3 — QR byte mode writes UTF-8 with no ECI (listed for the maintainer)

`qr-segments.ts` documents this choice. The 2015 standard puts the byte-mode default under clauses 7.3.5/7.4.5 and ECI under 7.3.2/7.4.2, per the DIN table of contents; the wording was not read (paywalled). ZXing's encoder defaults byte mode to ISO-8859-1. ZXing's decoder auto-detects UTF-8 (`StringUtils.guessCharset`) when the bytes are valid UTF-8 with a multibyte sequence. Pure ASCII is unaffected.

The refuter merged auditor candidate F6 here. With escapes on, `\x80\xE9` gives QR bytes C2 80 C3 A9 but Data Matrix bytes 80 E9. Both carry the same characters, so the split follows from this UTF-8 choice and is not an escape bug.

**Research:** PARTLY VERIFIED (clause located, wording unread). Adding ECI 26 would change every non-ASCII QR Code, so this goes to the maintainer.

### O1-P3-4 — A lone surrogate escape becomes U+FFFD in a QR Code without a message (listed)

With escapes on, `A\uD83DB` puts bytes 41 EF BF BD 42 into the QR Code. Data Matrix refuses the same input with its Latin-1 message. A correct surrogate pair given as two escapes gives F0 9F 98 80, which is right. Auditor and refuter both reproduced this.

Refusing a lone surrogate would change behaviour, so it is listed. No realistic input reaches it.

### O1-P3-5 — NFC normalisation in the dialog changes the encoded code points (listed)

`specFromDraft` (`src/ui/barcode/barcode-form.ts`) applies `normalize('NFC')` to the data:
- U+2126 OHM SIGN becomes U+03A9;
- U+212B ANGSTROM SIGN becomes U+00C5;
- U+F900 becomes U+8C48.

The same characters typed as `\u` escapes skip normalisation, so the two input paths disagree. These pairs are canonically equivalent, but a barcode carries code points, and a reader comparing bytes sees different data. The refuter found this (N2); the auditor confirmed it by reading the code.

Listed: removing NFC changes data for existing projects.

### O1-P3-6 — The fine-beam warning and the 0.05 mm floor ignore the object's scale (listed)

`layoutWarnings` and the 0.05 mm refusal read the dialog's module size. A 0.6 mm QR Code scaled to 25 % on the canvas engraves 0.15 mm modules with no "fine beam" note. The dialog still shows 0.6 mm when the code is edited. The refuter found this (N1).

#1780's Job Review check does use the placed module, which covers the scan-breaking case.

### O1-P3-7 — No GS1 retail sizing guidance for EAN/UPC (listed)

Research VERIFIED these against GS1 General Specifications R26.0:
- X-dimension 0.264 / 0.330 / 0.660 mm (§5.12.3.1 Table 5-44);
- nominal bar height 22.85 mm, 18.23 mm for EAN-8 (§5.2.3.2);
- truncation only when "absolutely no possibility" of full size (§4.2.7);
- height "SHALL NOT" go below the minimum (§5.12.4.1.3).

KerfDesk's EAN/UPC default is 0.33 mm, which is right, but the bar height defaults to 15 mm and nothing warns outside the X range. GS1 also widens or narrows the bars of characters 1, 2, 7 and 8 by 1/13 module (§5.2.3.1 Table 5-10). KerfDesk draws whole modules.

Readers decode all of these, so this is P3. Any change moves geometry or adds UI, so it is listed.

## Refuted

- **F8, ITF odd digit count gets a leading zero:** refuted as a defect. `123` encodes as `0123`. The caption and the dialog description ("Interleaved 2 of 5 0123") show it. The zint manual §6.1.2.4 and BWIPP (`interleaved2of5.ps.src`) pad the same way. ZXing's writer refuses odd input instead. It is a convention, not silent alteration.
- **F6, escape bytes differ between QR and Data Matrix:** merged into O1-P3-3 (refuter).
- **Auditor artefacts, withdrawn:**
  - Four capacity rows (27-L and 26-H) were wrong in the auditor's memory. The refuter checked every version and level at exact capacity and capacity + 1 (960 cases): 0 wrong versions.
  - A point-sample burn model with the spot narrower than the interval flagged default-size codes. That came from sampling the gaps between lines, and was replaced by the model-free "no line through a dark module" count.

## Verified clean

| Claim | Evidence | Research |
|---|---|---|
| QR Table 9 (160 rows) | Auditor's typed table equals `qrBlockLayout` for every version and level; totals equal free modules / 8 from the auditor's own function map | — |
| QR format and version words | Auditor BCH reproduces published L/0 = 111011111000100, M/0 = 0x5412, v7 = 07C94, v8 = 085BC, v40 = 28C69; all 2,000 symbols carry matching copies | — |
| QR codewords | ISO/IEC 18004 Annex I "01234567" 1-M: all 26 codewords exact | — |
| QR round trip | 2,000 auditor and 1,360 refuter symbols decode exactly; pads, terminator and remainder bits correct | — |
| QR segmentation | Refuter's exact O(n²) DP: 900/900 bit-optimal at v1, v10 and v27 | — |
| QR quiet zone 4X | `MIN_QUIET_ZONE.qr = 4` | VERIFIED: qrcode.com "four-module wide margin"; GS1 §5.7.4.2; ISO 18004:2015 clause 6.3.8 |
| Data Matrix sizes, RS, placement, pads | All 24 sizes decode in ISO order; ISO "123456" → 142 164 186 \| 114 25 5 88 102; 396 auditor and 438 refuter strings decode; fixed corner exact | — |
| Data Matrix quiet zone 1X | `MIN_QUIET_ZONE['data-matrix'] = 1` (default 2) | VERIFIED: GS1 §5.6.2 "one module wide on all four sides" |
| Code 128 | Table equals auditor transcription; 3,000 + 600 decode; never longer than the auditor's DP optimum (600) | Check: ZXing `Code128Writer`. 10X: zint cites ISO/IEC 15417 §4.4.2 (PARTLY VERIFIED) |
| Code 39, Code 93, Codabar, ITF | Fuzz decode with auditor tables; Code 39 ratio 3:1; Code 93 C/K weights 20/15; termination bar | Code 93 VERIFIED (zint, ZXing); ITF even count and 10X PARTLY VERIFIED; Code 39 and ITF ISO 2.0–3.0 ratio UNSOURCED (GS1 ITF-14: 2.25–3.0) |
| EAN-13/UPC-A/EAN-8/UPC-E/ISBN | Fuzz decode; parity tables; UPC-E expansion for every last digit and NS 0/1 (refuter 250/250) | VERIFIED: GS1 §7.9.1 Table 7-8 (check), §5.2.2.4.1 and Table 5-6 (UPC-E), §5.2.3.4 Table 5-11 (quiet zones 11/7, 9/9, 7/7, 9/7: KerfDesk's symmetric zones meet or exceed them), §5.2.3.2 (guard bars 5X) |
| Geometry | Every symbology, normal and inverted: all vertices on the module lattice; even-odd sampling reproduces the module grid; quiet zone clear (normal) or fully burned (inverted) | — |
| Rejections (L5) | Refused with a message: wrong check digits (EAN, UPC, UPC-E, ISBN-10/13), letters, wrong lengths, inner spaces, fullwidth and Arabic-Indic digits, NS 2 UPC-E, 977 "ISBN", Code 39 lowercase and `*`, non-ASCII Code 128/93, Codabar data letters, QR and Data Matrix over capacity, non-Latin-1 Data Matrix | — |
| Escapes (L4) | `\t`, `\x1D`, `é` and surrogate pairs give the intended characters; unknown or short escapes stay as typed | LightBurn's barcode page documents only `<GS>`/`<RS>` tokens, so there is no vendor contract for `\xHH` (UNSOURCED) |
| Data Matrix 144 × 144 (known, ADR-386 Amd 2) | KerfDesk writes ISO order; a ZXing-order read fails RS | New: ISO/IEC 16022:2024 clarifies the order ("restart with Block 1 (and not Block 9)", zxing-cpp issue #259). That matches what KerfDesk writes. ZXing, zint's default and several commercial readers read the rotated order, so the existing Job Review warning stays right |

## Not verified

- ISO/IEC 18004 §7.8.3 wording for the rule-3 border, and the byte-mode default wording (paywalled; clauses located through the DIN table of contents).
- Code 39 and ITF ISO 2.0–3.0:1 ratio range (UNSOURCED; GS1 gives 2.25–3.0:1 for ITF-14; KerfDesk uses 3:1, inside both).
- Any published "lines per module" or cell-fill rule for laser direct part marks (ISO/IEC TR 29158 and AIM DPM are paywalled; IAQG 9132 is cited only by secondary sources). O1-P2-1 does not depend on one.
- No camera or physical scan. Burn behaviour is simulated (line width equal to the interval) through the real `fillHatching`.
- Not in scope: GS1-128 / FNC1, QR Kanji and ECI, rectangular Data Matrix and C40/Text encodation (ADR-386 lists them as out of scope).

## Roles

- **Auditor:** the area session, which wrote the oracle plan and the independent reader.
- **Refuter:** a fresh subagent with its own harness, generators and DPs.
- **Research verifier:** a fresh subagent fetching GS1 R26.0, ZXing, zint, BWIPP, Nayuki, qrcode.com, the DIN TOC, LightBurn docs and zxing-cpp #259.
- **Owner re-check:** O1-P2-1 code re-read at 5c9441ba8.
