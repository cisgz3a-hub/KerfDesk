# Competitive audit — interim findings, sectors 1–9 (for external audit)

> **Purpose:** hand the completed half of the competitive audit to an external reviewer (Codex) to audit the *findings themselves* — ratings, win claims, gap claims, and their evidence — before the audit continues. This is a checkpoint, not the final report. **9 of 18 sectors are rated; 9 remain; the design's own calibration and adversarial-verification phases have NOT run yet.**
>
> **Everything here is derived from committed files.** Raw per-sector evidence and ratings are in `docs/audits/2026-07-12-competitive-audit/data/S0N-{evidence,market,ratings}.json`; full sector narratives are in `sectors/0N-*.md`. Methodology is `docs/audits/2026-07-11-competitive-sector-audit-design.md`. KerfDesk source pinned at commit `3e453074`; competitor versions pinned 2026-07-12 in `data/phase0.json`.

## How to read a rating

Anchored 0–10 (design §5.1): **0** absent · **2** token · **4** basic · **6** solid/daily-drivable · **8** parity with the sector leader's core · **10** best in this roster. `U` = unknown (evidence not found, excluded from means). `N/R` = product doesn't compete in the sector. `*` = hardware-dependent design-intent rating (none in S1–S9; those live in S10–S13). Evidence tags — KerfDesk: `PERC` perceptual proof > `LIVE` > `TEST` > `CODE` (file:line) > `HW-CLAIMED`; competitors: `HANDS` > `OFF` official docs > `COMM` community consensus (≥2 sources) > `INF` inferred.

**Two rules an auditor should check hardest:** (1) the **fidelity cap** — for categories 3.1, 3.2, 3.4, 4.1, 4.2, 6.3, 8.1, KerfDesk may not exceed 6 without perceptual proof produced this audit; (2) the **anti-over-claim rule** — every cell where KerfDesk ≥ best competitor must survive an adversarial refuter. That refuter pass has **not run yet**; the watchlist in §4 is exactly its target list.

## 1. Roster & pinned facts (from `data/phase0.json`)

| Product | Version (2026-07-12) | Price | Note for scoring |
|---|---|---|---|
| KerfDesk | commit `3e453074` | Free, MIT | subject |
| LightBurn | 2.1.03 | Core $99 / Pro $199 perpetual | laser reference |
| MillMage | 0.8.02 (Pro 0.9 in EA) | Core $99 | **CNC-only → N/R in laser sectors** |
| LaserGRBL | 7.14.1 (dormant ~16 mo) | Free/donation | free-laser baseline |
| XCS | = xTool Studio 1.7.30 (XCS discontinued 2025) | Free | consumer diode ecosystem |
| Easel | web SaaS | Free / $8 / $24 mo | CNC-beginner reference |
| Carbide Create | V8 | free / Pro $120yr | Tier-2: S1,7,8 |
| VCarve | 12.5 | $349 / $699 | Tier-2 CNC ceiling: S1,7,8 |
| gSender | 1.6.2 | Free (GPLv3) | Tier-2 sender: S8 |

## 2. Scorecard — sectors 1–9

KerfDesk sector means (rated cells only): **S1 4.6 · S2 5.1 · S3 7.0 · S4 5.9 · S5 6.7 · S6 5.8 · S7 5.9 · S8 6.0 · S9 7.0.**

### S1 Design & vector editing
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel | Carbide Create | VCarve |
|---|---|---|---|---|---|---|---|---|
| 1.1 Shape primitives | 4 | 9 | 8 | N/R | 7 | 4 | 4 | 9 |
| 1.2 Pen & node edit | 3 | 9 | 8 | N/R | 8 | 5 | 6 | 8 |
| 1.3 Boolean & modify | 6 | 9 | 8 | N/R | 7 | 3 | 7 | 9 |
| 1.4 Text | 3 | 10 | 8 | N/R | 7 | 5 | 5 | 8 |
| 1.5 Precision transforms | 6 | 9 | 8 | N/R | 6 | 6 | 5 | 9 |
| 1.6 Align/distribute/measure | 7 | 8 | 8 | N/R | 6 | 7 | 5 | 7 |
| 1.7 Snapping & guides | 4 | 9 | 8 | N/R | 6 | 6 | 5 | 7 |
| 1.8 Duplication & arrays | 4 | 9 | 8 | N/R | 7 | 4 | 5 | 9 |

### S2 Import/export & interop
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 2.1 Vector import breadth | 6 | 10 | 9 | 3 | 5 | 5 |
| 2.2 Raster import breadth | 4 | 8 | 8 | 7 | 10 | 3 |
| 2.3 Foreign project interop | 3 | 9 | 8 | 5 | 0 | 4 |
| 2.4 Import fidelity/robustness | 6 | 7 | U | 3 | 5 | 4 |
| 2.5 Import UX | 5 | 10 | 8 | U | 4 | 5 |
| 2.6 Export breadth | 5 | 10 | 9 | 3 | 6 | 3 |
| 2.7 Re-import & linked sources | 7 | 0 | 0 | 0 | U | 0 |

### S3 Image trace
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 3.1 Outline fidelity [fid] | 7 | 8 | 6 | 6 | 5 | 4 |
| 3.2 Centerline [fid] | 8 | 0 | 0 | 4 | 5 | 0 |
| 3.3 Controls/presets/UX | 7 | 8 | 7 | 6 | 6 | 4 |
| 3.4 Photo/multi-tone [fid] | 6 | 6 | 6 | 2 | 7 | 2 |
| 3.5 Robustness & speed | 7 | U | U | 6 | U | U |

### S4 Raster/image engrave
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 4.1 Dither breadth/quality [fid] | 6 | 10 | N/R | 6 | 5 | N/R |
| 4.2 Grayscale power map [fid] | 6 | 9 | N/R | 7 | 5 | N/R |
| 4.3 Image adjustments | 7 | 8 | N/R | 5 | 6 | N/R |
| 4.4 Line interval/DPI | 8 | 9 | N/R | 6 | 6 | N/R |
| 4.5 Raster transform freedom | 4 | 8 | N/R | 3 | 7 | N/R |
| 4.6 Scan options | 5 | 10 | N/R | 4 | 4 | N/R |
| 4.7 Pass-through/special | 5 | 9 | N/R | U | 4 | N/R |

### S5 Layers, cut settings & materials
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 5.1 Layer/color model | 7 | 9 | 5 | 0 | 4 | 0 |
| 5.2 Per-layer parameter breadth | 7 | 10 | 6 | 2 | 5 | 4 |
| 5.3 Multiple ops per layer | 7 | 10 | 7 | 0 | 0 | 0 |
| 5.4 Per-object overrides | 8 | 6 | 8 | 0 | 7 | 6 |
| 5.5 Material library | 6 | 9 | 5 | 0 | 8 | 7 |
| 5.6 Cut order & priority | 6 | 9 | 7 | 0 | 8 | 1 |
| 5.7 Settings-panel ergonomics | 6 | 10 | 7 | 0 | 5 | 4 |

### S6 Laser toolpath
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 6.1 Line-mode correctness | 6 | 9 | N/R | 4 | 5 | N/R |
| 6.2 Fill/hatch breadth | 8 | 10 | N/R | 2 | 6 | N/R |
| 6.3 Fill correctness [fid] | 7 | 7 | N/R | U | U | N/R |
| 6.4 Kerf offset | 7 | 8 | N/R | 0 | 6 | N/R |
| 6.5 Tabs/bridges/perforation | 6 | 9 | N/R | 0 | 6 | N/R |
| 6.6 Lead-ins & start points | 0 | 9 | N/R | 0 | 0 | N/R |
| 6.7 Multi-pass & Z-step | 6 | 9 | N/R | 4 | 5 | N/R |
| 6.8 Travel optimization | 6 | 9 | N/R | 3 | 6 | N/R |

### S7 CNC/router toolpath
| Cat | KerfDesk | MillMage | Easel | Carbide Create | VCarve |
|---|---|---|---|---|---|
| 7.1 Contour/profile | 6 | 8 | 5 | 6 | 10 |
| 7.2 Pocketing | 6 | 8 | 4 | 6 | 10 |
| 7.3 Drilling | 4 | 10 | 5 | 6 | 8 |
| 7.4 V-carve & engraving | 7 | 0 | 4 | 8 | 10 |
| 7.5 Tabs/ramps/lead-ins | 6 | 8 | 6 | 6 | 10 |
| 7.6 Depth management | 6 | 8 | 5 | 6 | 10 |
| 7.7 Tool library & feeds | 6 | 8 | 5 | 8 | 10 |
| 7.8 3D relief / STL | 6 | 0 | 6 | 8 | 9 |

(LightBurn/LaserGRBL/XCS N/R in S7 — no CNC toolpath.)

### S8 Preview/simulation/estimation
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel | Carbide Create | VCarve | gSender |
|---|---|---|---|---|---|---|---|---|---|
| 8.1 Preview fidelity [fid] | 7 | 9 | 6 | 4 | 6 | 6 | 4 | 7 | 6 |
| 8.2 Playback | 6 | 10 | 8 | 0 | 8 | 6 | 4 | 7 | 0 |
| 8.3 Time-estimate accuracy | 5 | 8 | 5 | 6 | 4 | 5 | 3 | 6 | 5 |
| 8.4 Power/mode visualization | 5 | 10 | 7 | 3 | 6 | 5 | 4 | 8 | 4 |
| 8.5 CNC material-removal sim | 7 | N/R | 7 | N/R | N/R | 6 | 6 | 10 | 0 |
| 8.6 Preview performance | 6 | 8 | U | U | U | U | 3 | 7 | 9 |

### S9 G-code & motion output
| Cat | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel |
|---|---|---|---|---|---|---|
| 9.1 Arc output (G2/G3) | 7 | 4 | 3 | 2 | U | 2 |
| 9.2 Power scaling & modes | 8 | 9 | 6 | 6 | 3 | 5 |
| 9.3 Output customization | 3 | 10 | 8 | 6 | U | U |
| 9.4 Dialect breadth | 6 | 10 | 8 | 3 | 2 | 3 |
| 9.5 Output structure/provenance | 9 | 6 | 6 | U | U | U |
| 9.6 Motion-safety guarantees | 9 | 6 | 6 | U | U | 5 |

## 3. Interpretation so far (subject to change; S10–S18 unrated)

- **KerfDesk trails the paid design suites badly on drafting (S1 mean 4.6).** Text (3), pen/node editing (3), and shape primitives (4) are the deepest holes. This is the LightBurn-switcher persona's daily surface.
- **The spine is strong.** Where KerfDesk was engineered as a pure pipeline it competes or leads: G-code provenance/determinism and motion-safety scanning (9/9 vs 6), native G2/G3 arcs (only product in roster on the CNC path), the fill/hatch model, per-object overrides, and the centerline trace.
- **Fidelity claims are honestly capped.** Every [fid] cell that lacks production-scale perceptual proof is held at ≤7 with the gap stated; none is inflated to parity on green tests. Auditor should confirm the cap wasn't circumvented.
- **Un-ADR'd LightBurn divergences drive several severe gaps** (design §5.6 bumps their severity): no artwork export (2.6), replace-on-reimport (2.7), no vector shade-by-power in preview (8.4), pass-through still dithers (4.7), tabs-off default citing a nonexistent ADR (7.5).

## 4. ⚠ Over-claim watchlist — audit these hardest (anti-over-claim pass NOT yet run)

Every cell where KerfDesk rates **≥ the best competitor**. Per design §5.5 each must survive an adversarial refuter that checks (a) the KerfDesk capability really exists at claimed depth and verification status, and (b) no competitor capability was missed. **This is the single most important list for an external auditor.**

| Cat | KD | best | leader(s) | KD evidence | the claim to attack |
|---|---|---|---|---|---|
| 2.7 Re-import | 7 | 0 | LB/MM/LGRBL/Easel | CODE | that "same-file re-import replaces in place" is a *lead* and not just an un-ADR'd divergence others intentionally avoid |
| 3.2 Centerline | 8 | 5 | XCS | PERC | roster-best medial-axis trace, but proof is **synthetic bars only** (maxDev 0.79px), never real logos vs LightBurn/Inkscape |
| 3.5 Trace robustness | 7 | 6 | LaserGRBL | TEST | edge over LaserGRBL rests on 4 of 5 competitor cells being `U` — LOW-CONFIDENCE |
| 5.4 Per-object override | 8 | 8 | MillMage | CODE | tie claim; is MillMage's per-object model actually equal or better? |
| 6.3 Fill correctness | 7 | 7 | LightBurn | PERC | perceptual proof is **32×32 synthetic only**; parity with LightBurn at real scale unproven |
| 9.1 Arc output | 7 | 4 | LightBurn | CODE | "only roster product with native G2/G3" — but KerfDesk laser path is G1-only; arcs are CNC-path only (open MAJOR S5-F4) |
| 9.5 Provenance/determinism | 9 | 6 | LB/MM | TEST | byte-identical + provenance header — is 9 vs 6 too wide? do competitors have undocumented determinism? |
| 9.6 Motion safety | 9 | 6 | LB/MM | TEST | post-emit safety scans — is scanning emitted G-code actually superior to firmware-side limits, or different scope? |

## 5. Wins claimed (30) — candidate, unrefuted

Grouped; each is `S.cat vs product (+Δ): claim`. Full evidence in the sector JSONs.

**Trace (S3):** 3.2 vs LightBurn (+8) only roster centerline w/ perceptual proof · 3.2 vs LaserGRBL (+4) · 3.2 vs XCS (+3) · 3.5 vs LaserGRBL (+1, LOW-CONF).
**G-code (S9):** 9.1 vs LightBurn (+3) native G2/G3 · 9.5 vs LightBurn (+3) determinism+provenance · 9.6 vs LightBurn (+3) emitted-output safety scans.
**Fill/raster (S4,S6):** 6.2 vs LaserGRBL (+6) full fill model · 6.2 vs XCS (+2) offset/island/fill+line · 4.3 vs LaserGRBL (+2) · 4.4 vs LaserGRBL (+2) · 4.4 vs XCS (+2).
**Preview/sim (S8):** 8.2 vs LaserGRBL (+6) pre-run simulator · 8.2 vs gSender (+6) · 8.1 vs Carbide Create (+3) parity-tested preview · 8.5 vs Carbide Create (+1) · 8.5 vs Easel (+1).
**CNC (S7):** 7.4 vs MillMage (+7) medial-axis V-carve MillMage lacks · 7.8 vs MillMage (+6) STL relief · 7.4 vs Easel (+3) · 7.2 vs Easel (+2).
**Layers (S5):** 5.4 vs LightBurn (+2) full per-object settings fork · 5.1 vs XCS (+3) · 5.2 vs XCS (+2).
**Import (S2):** 2.1 vs LaserGRBL (+3) · 2.3 vs XCS (+3) at least visualizes G-code · 2.4 vs LaserGRBL (+3) · 2.6 vs Easel (+2) unmetered export.
**Design (S1):** 1.3 vs Easel (+3) full boolean+offset suite · 1.6 vs Carbide Create (+2) align/distribute/measure.

## 6. Gaps found (52) — top of the register

**P0-candidate parity holes (largest deltas, headline workflows):**
- **6.6 Lead-ins & start points = 0** vs LightBurn 9 — no seam placement or lead-in/out at all.
- **1.4 Text = 3** vs LightBurn 10 (−7) — 4 fonts, one weight, modal-only, no bold/italic/text-on-path.
- **9.3 Output customization = 3** vs LightBurn 10 (−7) — no editable start/end/tool-change G-code or headers.
- **2.6 Export = 5** but no *artwork* export at all (SVG/DXF/image out) — designs enter, never leave as vectors.
- **2.3 Foreign project interop = 3** vs LightBurn 9 — no .lbrn/.lbrn2 reader for the switcher persona (un-ADR'd, §5.6 bump).
- **7.3 Drilling = 4** vs MillMage 10 (−6); **1.2 pen/node = 3** vs LightBurn 9 (−6); **2.2 raster import = 4** vs XCS 10 (−6).

**Un-ADR'd divergences flagged for severity bump (§5.6):** 2.2.4 SVG text/images silently dropped · 2.7 replace-on-reimport · 4.7 pass-through still dithers · 5.3 dead 'Visible' checkbox · 7.5 tabs-off default cites nonexistent ADR · 8.4 no vector shade-by-power (contradicts ADR-028).

Full 52-gap list with file:line and effort sizing is reconstructable from the `gaps` arrays in `data/S0N-ratings.json`; the final `gap-register.md` (design Appendix B: ID, severity P0–P3, ADR-recorded?, effort, recommendation) is produced in synthesis after all 18 sectors.

## 7. What an auditor should know is NOT done

1. **Sectors 10–18 unrated** (machine control, job execution/recovery, camera, rotary, material test, layout/production, device breadth, platform, onboarding/commercial). Roughly the entire hardware-facing and commercial half.
2. **Calibration pass not run** — cross-sector anchor normalization (a 7 in S1 must equal a 7 in S9) happens after all sectors; current means may carry rater-to-rater drift.
3. **Adversarial verification not run** — the §4 watchlist and all 30 wins are candidate, unrefuted. Any that a refuter breaks get corrected downward.
4. **No hardware, either side** — S10–S13 will carry `*` design-intent ratings; every KerfDesk hardware pass is CLAIMED, not verified.
5. **Competitor evidence is documentary** — `OFF`/`COMM`/`INF`, not hands-on; `INF` cells cannot anchor a headline.

## 8. Specific questions for the external auditor

1. Are any of the 8 over-claim cells (§4) indefensible? Especially **3.2 centerline (synthetic-only proof rated 8)**, **9.5/9.6 (9 vs 6 — too wide?)**, and **2.7 (a divergence claimed as a lead)**.
2. Did the fidelity cap get applied correctly — is any [fid] cell above 6 without production-scale perceptual proof?
3. Are competitor scores too generous or too harsh anywhere the delta drives a win/gap? LightBurn is the anchor; if LightBurn is mis-scored the whole column tilts.
4. Any category where a competitor capability was missed entirely (existence "no"/"unknown" that should be "yes")?
5. Is the N/R assignment right — MillMage N/R in laser sectors, LightBurn/XCS N/R in S7 CNC?
