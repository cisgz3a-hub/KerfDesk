# KerfDesk competitive sector audit — design (2026-07-11)

> **Status: DESIGN — for maintainer approval before any execution.** This document defines the methodology for a full competitive audit of KerfDesk against the products a buyer would actually weigh it against: the roster, the sector/category map, the rating rubric, the evidence standards, the execution plan, and the deliverable formats. Nothing has been rated yet. When the audit runs it will be **report-only** per CLAUDE.md collaboration rule 1 — findings and ratings, no code changes. Branch `claude/software-audit-design-009ac5`.

---

## 1. The question this audit answers

> For each thing a laser or CNC user does in this category of software, how good is KerfDesk **relative to the named competitors** — where do we win, where do we lose, by how much, and what would closing each gap cost?

Three artifacts make the answer actionable:

1. **Scorecard** — every category × every product gets a 0–10 rating with an evidence tag. ~115 categories across 18 sectors.
2. **Gap register** — every category where we materially trail, ranked by severity and effort.
3. **Wins register** — every category where we lead, adversarially verified. This is the defensible marketing/positioning story.

## 2. Relationship to the 2026-07-10 internal audit

The internal full-sweep audit (`2026-07-10-consolidated-audit-v2.md`, 18 sectors, letter grades, 86 adversarial verdicts) measured **absolute quality of our own tree** — defects, drift, code health. This audit measures **relative capability and experience against named products**. They are complementary, not redundant:

| | Internal audit (done) | Competitive audit (this design) |
|---|---|---|
| Unit of judgment | Defect / finding, file:line | Category rating, product vs product |
| Reference | Our own specs + LightBurn behavior | The whole roster, per category |
| Sectors | Includes code-facing sectors (architecture, test/CI quality) | Buyer-facing sectors only — competitor internals aren't visible and buyers don't rate them |
| Output | Grades + priority register | Numeric matrix + gap/wins registers + persona roll-ups |

The internal audit is the pre-collected KerfDesk evidence base for this one: Phase 1 agents start from it and delta against current `main` (which has advanced since its pinned commit — rotary/emitter, the ADR-128 measured-boundary trace line, the R1–R6 re-audit fixes) rather than re-discovering the tree from scratch.

## 3. Roster — products under comparison

Tier 1 products are rated in every sector they plausibly compete in. Tier 2 products are rated only in their listed sectors (`N/R` elsewhere). Tier 3 products are context-only — cited in narrative where useful, never given a matrix column.

| Product | Vendor | Model (indicative — re-verify at Phase 0) | Why it's in the roster | Tier |
|---|---|---|---|---|
| **KerfDesk** (LaserForge 2.0) | us | Free, MIT, web PWA + Windows Electron | The subject | — |
| **LightBurn** | LightBurn Software | Paid license, GCode/DSP editions | The laser reference. PROJECT.md deliberately copies its UX; our users come from it | 1 |
| **MillMage** | LightBurn Software | Paid (~$99 at last check) | Same vendor's CNC app — the direct threat to our dual laser+CNC play | 1 |
| **LaserGRBL** | open source | Free (Windows) | The free-laser baseline; PROJECT.md names it as where our users come from | 1 |
| **xTool Creative Space (XCS)** | xTool | Free with xTool hardware | Consumer-ecosystem reference for exactly the diode brands in our device catalog | 1 |
| **Easel** | Inventables | Freemium web CNC | The CNC-beginner reference; our ADR-111 beginner pack was designed against it | 1 |
| **Carbide Create** | Carbide 3D | Free (Pro paid) | Free CNC design+CAM bar | 2 — S1, S7, S8, S14, S18 |
| **Vectric VCarve** (Desktop/Pro) | Vectric | Paid (mid hundreds USD) | The CNC CAM quality ceiling for the Router phase | 2 — S1, S7, S8, S15, S18 |
| **gSender** | Sienci Labs | Free | Best-regarded free sender UX; job recovery reference | 2 — S8, S10, S11, S16, S17 |
| Inkscape, Fusion 360 CAM, Rayforge, UGS/Candle, Snapmaker Luban | — | — | Narrative context only (e.g. "Inkscape does X for free", "Fusion is the V-carve ceiling") | 3 |

**Roster rules.**

- **Version pinning (Phase 0).** Before any rating, one agent freezes a `product / version / release date / price checked on <date>` table into the audit's `methodology.md`. Every price and edition claim in the table above is indicative from prior sessions and gets re-verified then — nothing in this design doc is a citable competitor fact.
- **Sector coverage confirmation (Phase 0).** MillMage and XCS are young/fast-moving; their exact sector coverage (does MillMage rate in laser sectors? does XCS rate in CNC?) is confirmed from current official docs at Phase 0, not assumed here.
- `N/R` (not rated) is reserved for products that don't compete in a sector. For a product that *should* compete there, a missing capability is a **0**, not `N/R`.

## 4. The rated surface — 18 sectors, ~115 categories

Every category below gets one rating per rated product. Categories marked **[fidelity]** and **[⚠HW]** trigger the special rules in §5.

### S1 · Design & vector editing

| # | Category | What's measured |
|---|---|---|
| 1.1 | Shape primitives | Rect/ellipse/polygon/star/line richness; parametric re-editing after creation |
| 1.2 | Pen & node editing | Bezier drawing; node add/delete/drag; curve handle control |
| 1.3 | Boolean & modify ops | Union/subtract/intersect, weld, design-time offset/inset |
| 1.4 | Text tools | Font breadth, spacing/line-height, bold/italic, text-on-path, glyph weld |
| 1.5 | Precision transforms | Numeric position/size entry, rotate/mirror/skew, reference points |
| 1.6 | Align, distribute & measure | Alignment/distribution tools, measurement |
| 1.7 | Snapping & guides | Object/grid snap, guides, grid control |
| 1.8 | Duplication & arrays (design-time) | Duplicate, offset-duplicate, grid/circular array |

### S2 · Import, export & interop

| # | Category | What's measured |
|---|---|---|
| 2.1 | Vector import breadth | SVG, DXF, AI, PDF, EPS, CDR, PLT… |
| 2.2 | Raster import breadth | PNG, JPG, BMP, GIF, TIFF, WebP… |
| 2.3 | Foreign project interop | Reading .lbrn/.lbrn2, .crv, .easel; G-code import/visualize |
| 2.4 | Import fidelity & robustness | Units/DPI handling, curve preservation, text, malformed-file behavior |
| 2.5 | Import UX | Universal picker, drag-drop, clipboard paste, recent files |
| 2.6 | Export breadth | SVG/DXF/image out, project export/share |
| 2.7 | Re-import & linked sources | Replace-on-reimport, update-from-file workflows |

### S3 · Image trace (bitmap → vector)

| # | Category | What's measured |
|---|---|---|
| 3.1 | Outline trace fidelity **[fidelity]** | Does the traced result match the source, perceptually |
| 3.2 | Centerline trace **[fidelity]** | Single-stroke extraction quality |
| 3.3 | Controls, presets & preview UX | Threshold/smoothing/ignore-small, live preview |
| 3.4 | Photo & multi-tone handling **[fidelity]** | Non-binary sources |
| 3.5 | Robustness & speed at size | Large images, degenerate inputs |

### S4 · Raster / image engrave pipeline

| # | Category | What's measured |
|---|---|---|
| 4.1 | Dither breadth & quality **[fidelity]** | Threshold, error-diffusion family, ordered, halftone/newsprint |
| 4.2 | Grayscale power mapping **[fidelity]** | Variable-power engraving |
| 4.3 | Image adjustments | Brightness/contrast/gamma, invert, crop/mask |
| 4.4 | Line interval / DPI control | Resolution controls, units, guidance |
| 4.5 | Raster transform freedom | Rotate/scale/flip/skew of a raster op |
| 4.6 | Scan options | Scan angle, bidirectional, overscan controls |
| 4.7 | Pass-through & special modes | Pre-dithered pass-through, negative, etc. |

### S5 · Layers, cut settings & materials

| # | Category | What's measured |
|---|---|---|
| 5.1 | Layer/color model | Layer count, palette-assignment ergonomics |
| 5.2 | Per-layer parameter breadth | Power/speed/passes/Z-step/air/interval… |
| 5.3 | Multiple ops per layer | Sub-layers or fill+line stacking |
| 5.4 | Per-object overrides | Object-level deviation from layer settings |
| 5.5 | Material library | Native format, editing UX, import, manufacturer/community libraries |
| 5.6 | Cut order & priority control | Layer priority, manual ordering |
| 5.7 | Settings-panel ergonomics | The "Cuts panel" daily-driver experience |

### S6 · Laser toolpath generation

| # | Category | What's measured |
|---|---|---|
| 6.1 | Line-mode correctness | Closed paths, seams, direction control |
| 6.2 | Fill/hatch breadth | Angle/spacing, cross-hatch, snake, offset-fill, fill+line |
| 6.3 | Fill correctness **[fidelity]** | Holes/even-odd, shared edges, small features |
| 6.4 | Kerf offset | Inward/outward compensation |
| 6.5 | Tabs, bridges & perforation | Laser tabs, perforation/dash modes |
| 6.6 | Lead-ins & start points | Start-point control, lead-in/out |
| 6.7 | Multi-pass & Z-step | Pass count, Z step-down per pass |
| 6.8 | Travel optimization | Cut-order optimization quality |

### S7 · CNC / router toolpath

| # | Category | What's measured |
|---|---|---|
| 7.1 | Contour/profile ops | Inside/outside/on-line, climb/conventional |
| 7.2 | Pocketing | Strategies, stepover/stepdown control |
| 7.3 | Drilling | Drill/peck operations |
| 7.4 | V-carve & engraving ops | V-bit carving quality and controls |
| 7.5 | Tabs, ramps & lead-ins | Holding tabs, ramp entry |
| 7.6 | Depth management | Multi-pass depth, finishing allowance |
| 7.7 | Tool library & feeds/speeds | Tool definitions, guidance quality |
| 7.8 | 3D relief / STL | Height-map and STL workflows |

### S8 · Preview, simulation & estimation

| # | Category | What's measured |
|---|---|---|
| 8.1 | Preview geometric fidelity **[fidelity]** | Preview matches emitted output |
| 8.2 | Playback | Scrub, speed, step-through |
| 8.3 | Time-estimate accuracy | Estimate vs real run time |
| 8.4 | Power/mode visualization | Shade-by-power, travels, direction |
| 8.5 | CNC material-removal sim | 3D stock simulation |
| 8.6 | Preview performance | Behavior at production scale |

### S9 · G-code & motion output quality

| # | Category | What's measured |
|---|---|---|
| 9.1 | Arc output | G2/G3 emission vs segmentation; curve quality |
| 9.2 | Power scaling & modes | M3/M4 handling, S-max ($30) correctness |
| 9.3 | Output customization | Start/end/tool-change hooks, custom headers |
| 9.4 | Dialect breadth | grbl, grblHAL, FluidNC, Marlin, Smoothie, Ruida binary… |
| 9.5 | Output structure & provenance | Headers, comments, determinism |
| 9.6 | Motion-safety guarantees | Laser-off travels, bounds discipline, non-finite guards |

### S10 · Machine control & streaming

| # | Category | What's measured |
|---|---|---|
| 10.1 | Connect UX | Auto-detect, profiles, baud handling |
| 10.2 | Jog | Continuous, keyboard, speed presets, go-to/park |
| 10.3 | Framing | Bounds + rubber-band frame, low-power trace |
| 10.4 | Fire / test pulse | Diode-alignment pulse control |
| 10.5 | Console & macros | Manual command surface, user macros |
| 10.6 | Status surfaces | DRO, alarm decoding, firmware-settings UI |
| 10.7 | Streaming robustness **[⚠HW]** | Buffering, throughput, long-job stability |
| 10.8 | Multi-device management | Multiple machines/profiles side by side |

### S11 · Job execution, recovery & safety

| # | Category | What's measured |
|---|---|---|
| 11.1 | Start-position modes | Absolute / user origin / current position |
| 11.2 | Pause/resume correctness **[⚠HW]** | Beam off, position hold, clean resume |
| 11.3 | Stop/abort behavior | Immediate, safe, recoverable |
| 11.4 | Power-loss / disconnect recovery **[⚠HW]** | Resume at line/position after failure |
| 11.5 | Preflight & bounds checks | Pre-run validation, config-mismatch warnings |
| 11.6 | In-run feedback | Progress, ETA, current line, alarm surfacing |
| 11.7 | Run selection only | Cut-selected / run-from-here |
| 11.8 | Safety posture | Warnings, interlock awareness, fire-risk guidance |

### S12 · Camera & registration

| # | Category | What's measured |
|---|---|---|
| 12.1 | Calibration workflow | Lens + mount alignment process |
| 12.2 | Overlay accuracy & UX **[⚠HW]** | Positioning work by camera |
| 12.3 | Trace from camera | Capture-to-vector workflows |
| 12.4 | Print-and-cut / registration marks **[⚠HW]** | Registered cutting of printed media |
| 12.5 | Fixture & board capture | Jig/board workflows for repeat placement |

### S13 · Rotary & specialty

| # | Category | What's measured |
|---|---|---|
| 13.1 | Rotary setup | Roller/chuck config, wizard, test |
| 13.2 | Rotary output correctness **[⚠HW]** | Circumference mapping, preview |
| 13.3 | Focus & Z tools | Focus test, material thickness, autofocus integration |
| 13.4 | Specialty modes | Curved/tilted-surface compensation, automated air assist, etc. |

### S14 · Material test & calibration

| # | Category | What's measured |
|---|---|---|
| 14.1 | Power×speed test grids | Generator quality and flexibility |
| 14.2 | Interval & focus tests | Line-interval and focus-ramp generators |
| 14.3 | Test customization | Labels, parameter axes, safety caps |
| 14.4 | Calibration round-trip | Test result → saved material setting |

### S15 · Layout & production

| # | Category | What's measured |
|---|---|---|
| 15.1 | Array/grid replication | Production-time duplication |
| 15.2 | Auto-fit / fill-the-board | Maximizing stock usage automatically |
| 15.3 | True nesting | Irregular-shape nesting |
| 15.4 | Stock shape support | Rect, circle, custom outlines, offcuts |
| 15.5 | Batch & variable content | Serials, names, variable text, codes |
| 15.6 | Repeat-job ergonomics | Templates, saved jobs, quick re-run |

### S16 · Device & firmware breadth

| # | Category | What's measured |
|---|---|---|
| 16.1 | GRBL-family depth | grbl 1.1, grblHAL, FluidNC specifics |
| 16.2 | Other firmware | Marlin, Smoothieware, … |
| 16.3 | DSP/proprietary controllers | Ruida and friends |
| 16.4 | Profile catalog | Breadth + correctness of shipped machine profiles |
| 16.5 | Setup wizard quality | New-device onboarding |

### S17 · Platform, performance & reliability

| # | Category | What's measured |
|---|---|---|
| 17.1 | OS/platform coverage | Windows/macOS/Linux/web/tablet |
| 17.2 | Offline & install/update | PWA/offline capability, update experience |
| 17.3 | Large-design performance | Big SVGs, big rasters, many objects |
| 17.4 | Stability & crash recovery | Autosave, session restore, crash behavior |
| 17.5 | Project-format robustness | Save stability, versioning/migration |
| 17.6 | Resource footprint | Memory/CPU at typical and heavy load |

### S18 · Onboarding, docs, ecosystem & commercial

| # | Category | What's measured |
|---|---|---|
| 18.1 | First-run & beginner experience | Wizards, beginner mode, safe defaults |
| 18.2 | Documentation | Coverage and quality |
| 18.3 | Learning ecosystem | Tutorials, videos, community size |
| 18.4 | Projects & assets | Marketplace/libraries of ready-to-cut content |
| 18.5 | Extensibility | Scripting, plugins, API |
| 18.6 | Localization | UI languages |
| 18.7 | Price, licensing & openness | Cost, license model, source availability, update cadence |

Deliberately absent: architecture, code health, and test/CI quality (internal-audit concerns — competitor internals aren't observable), and per-sector UX is rated *inside* each sector rather than as a separate global sector, to avoid double-counting.

## 5. Rating system

### 5.1 Scale — anchored 0–10, integers only

| Score | Anchor |
|:---:|---|
| 0 | Absent (for a product that competes in this sector) |
| 2 | Token — exists but effectively unusable for real work |
| 4 | Basic — handles the simple case; real users hit walls immediately |
| 6 | Solid — daily-drivable; clear gaps vs the sector leader |
| 8 | Parity — matches the sector leader's core capability; gaps only at edges |
| 10 | Leading — the best implementation in this roster; others chase it |

Odd numbers sit between anchors. Anchors are **relative to this roster**, not abstract: "10" means best of these products, and at most one product per category normally holds it. `N/R` = product doesn't compete in the sector. `U` = unknown — evidence could not be found either way; a `U` is **excluded from roll-ups** and logged as research debt rather than guessed at (CLAUDE.md rule 5: no invention).

### 5.2 Cell grammar

Every scorecard cell is `score[*] [EVIDENCE]` with a footnote citation. Example: `7 [CODE]` with `src/core/...:L120` in the footnote, or `8 [OFF]` with the vendor-doc URL. `*` marks a hardware-dependent design-intent rating (§5.4).

### 5.3 Fidelity cap (operationalizes CLAUDE.md rule 2)

For the seven **[fidelity]** categories (3.1, 3.2, 3.4, 4.1, 4.2, 6.3, 8.1), a KerfDesk rating **above 6 requires perceptual evidence produced or re-run during this audit** — the perceptual harness (`src/__fixtures__/perceptual/`, ADR-025), a rendered-output diff, or a maintainer-confirmed visual pass. Green structural tests alone cap the score at 6 regardless of how good the code looks. The sector report must state what was and was not perceptually verified.

### 5.4 Hardware-dependent categories

Categories tagged **[⚠HW]** (10.7, 11.2, 11.4, 12.2, 12.4, 13.2) can only be *fully* proven on a machine, which this audit does not have (and per the repo's standing ledger, every KerfDesk hardware pass is currently CLAIMED, not VERIFIED). Rule: these cells are rated on **designed capability + documentary/community signal**, marked with `*`, and each product gets a **proof-debt count** in the scorecard (KerfDesk's will be honest and high). No un-starred hardware claims.

### 5.5 Anti-over-claim rule

Every category where KerfDesk's proposed rating is **≥ the best competitor's**, and every "where we win" bullet, goes to an independent adversarial verifier instructed to refute it before publication. This is a direct lesson from the 2026-07-11 re-audit round, where an external reviewer caught exactly this kind of over-claim once. Nothing ships as a win unrefuted.

### 5.6 LightBurn-reference rule (severity, not score)

Capability ratings measure what exists. But per CLAUDE.md rule 3, in shared workflows a **behavioral divergence from LightBurn that no ADR records is a bug, not a choice** — that classification feeds the gap register's severity column (an un-ADR'd divergence ranks above an equally-sized deliberate one). Raters must check `DECISIONS.md` before classifying; an ADR-recorded divergence is a maintainer decision.

## 6. Roll-ups — personas and weights (proposed, maintainer approves)

A single overall number would mislead: rotary matters to a laser buyer and not at all to a CNC beginner; V-carve is the reverse. Ratings roll up per **persona**:

- Sector score = mean of the product's rated categories in the sector (`N/R`/`U` excluded; a sector with >30% `U` cells is flagged LOW-CONFIDENCE).
- Persona score = Σ (sector weight × sector score) / 100.

| Sector | P1 · LightBurn-switcher laser hobbyist | P2 · CNC beginner (Easel switcher) | P3 · Small production shop (laser) |
|---|:---:|:---:|:---:|
| S1 Design & editing | 8 | 7 | 5 |
| S2 Import & interop | 6 | 5 | 8 |
| S3 Image trace | 7 | 2 | 4 |
| S4 Raster engrave | 10 | 0 | 7 |
| S5 Layers & materials | 7 | 6 | 8 |
| S6 Laser toolpath | 9 | 0 | 8 |
| S7 CNC toolpath | 0 | 18 | 2 |
| S8 Preview & sim | 4 | 8 | 4 |
| S9 G-code quality | 7 | 7 | 6 |
| S10 Machine control | 8 | 9 | 6 |
| S11 Execution & recovery | 7 | 9 | 9 |
| S12 Camera & registration | 4 | 2 | 6 |
| S13 Rotary & specialty | 3 | 0 | 3 |
| S14 Material test | 4 | 4 | 3 |
| S15 Layout & production | 3 | 4 | 9 |
| S16 Device breadth | 4 | 5 | 3 |
| S17 Platform & reliability | 5 | 6 | 6 |
| S18 Onboarding & commercial | 4 | 8 | 3 |
| **Total** | **100** | **100** | **100** |

The scorecard reports each product per persona. No headline "X/10 overall" without persona context.

## 7. Evidence standards

### 7.1 KerfDesk side

Tag hierarchy: `[PERC]` rendered/perceptual proof > `[LIVE]` verified in the running app > `[TEST]` automated test > `[CODE]` traced source (file:line) > `[HW-CLAIMED]` hardware-dependent, unverified. Every KerfDesk cell carries at least one tag with a citation.

- **Reuse, don't rediscover.** Start from the 2026-07-10 consolidated audit v2 and full-sweep report; delta against current `main` at a freshly pinned commit.
- **Live checks are side-effect-free** (CLAUDE.md rule 4): isolated function checks on throwaway DOM/canvas, never synthetic events into the maintainer's real scene.
- **Prior competitive impressions do not anchor.** Earlier session-level competitive audits (2026-06, 2026-07-07) produced summary ratings; raters must not import those numbers — fresh evidence only.

### 7.2 Competitor side

Tag hierarchy: `[HANDS]` hands-on run > `[OFF]` official docs/manual/release notes > `[COMM]` community consensus (≥ 2 independent sources — forum threads, videos) > `[INF]` inferred. Rules:

- `[INF]` cells are visually flagged and **cannot support any headline conclusion or win/lose bullet**.
- Marketing pages count as `[OFF]` for existence of a feature but not for its quality; quality needs `[COMM]` or `[HANDS]`.
- **Contested categories** — where the win/lose verdict flips on the answer — are escalated to the maintainer for a hands-on check if a license/install is available (§12, decision 3).

## 8. Execution plan (runs only on explicit maintainer go)

| Phase | What happens | Agents (est.) |
|---|---|---|
| **0 · Pin & pack** | Pin KerfDesk commit; freeze roster versions/prices; confirm MillMage/XCS sector coverage; assemble per-product source packs (official docs index, manual links, community sources) | ~3 |
| **1 · Sector dossiers** | Per sector: (a) KerfDesk evidence agent — tree + prior-audit reuse + side-effect-free LIVE + PERC runs for fidelity cells; (b) market agent — competitor evidence per category from the source packs; (c) sector rater — drafts the category table with anchored ratings, narrative, win/lose bullets, candidate gaps | 18 × 3 = 54 |
| **2 · Calibration** | One calibrator normalizes anchors across sectors (a 7 in S6 must equal a 7 in S10), enforces the fidelity cap and `*` rules, harmonizes duplicate evidence | ~4 |
| **3 · Adversarial verification** | Refute every KerfDesk-leads cell and every win/lose headline; spot-verify a sample of `[COMM]`/`[OFF]` competitor claims against second sources | ~30–50 |
| **4 · Synthesis** | Scorecard assembly, persona roll-ups, gap register, wins register, roadmap recommendation | ~4 |

**Budget expectation.** The 2026-07-10 internal wave 1 ran 70 agents / ~7.8M tokens / ~39 min. This audit adds web research per sector, so expect **~110–140 agents, roughly 10–15M tokens**. It can run as one shot or as three waves of six sectors if the maintainer prefers reviewable chunks.

**What execution will NOT do:** no hardware verification on either side; no installing competitor software (agents use documentary evidence; hands-on only via the maintainer); no code changes; no publishing anything outside the repo.

## 9. Deliverables

```
docs/audits/2026-07-XX-competitive-audit/
├── methodology.md      # this design, frozen, + the Phase-0 version-pin table
├── scorecard.md        # full matrix, persona roll-ups, proof-debt counts, U-cell log
├── sectors/
│   ├── 01-design-editing.md
│   ├── ...             # one per sector (template: Appendix A)
│   └── 18-onboarding-commercial.md
├── gap-register.md     # schema: Appendix B
├── wins-register.md    # verified leads only (§5.5)
└── roadmap.md          # report-only recommendation ordering (maintainer decides)
```

## 10. Rules of engagement

1. **Report-only** (CLAUDE.md rule 1). The audit changes no product source. The maintainer chooses what to act on. (If the maintainer subsequently sets a fix-all goal, that choice supersedes — but it is a separate instruction, not part of the audit.)
2. **State what was not verified** (rule 2 / Karpathy's law). The scorecard carries per-product proof-debt counts; each sector report ends with an explicit "Not verified" list.
3. **LightBurn is the behavioral reference** (rule 3) — via the severity rule in §5.6.
4. **Side-effect-free live verification only** (rule 4).
5. **No invention** (rule 5). `U` beats a guessed number; every cell cites evidence.
6. **No unrefuted win claims** (§5.5).

## 11. Known limitations — stated up front

- **Competitor evidence is documentary** unless the maintainer provides hands-on time. Vendor docs overstate; forums understate. Error bars are asymmetric, and the design compensates (quality needs `[COMM]`+, `[INF]` barred from headlines) but cannot eliminate this.
- **No hardware anywhere.** Burn/cut *results* are out of scope on both sides; hardware-dependent cells are design-intent ratings with `*`.
- **Snapshot, not a feed.** LightBurn/MillMage/XCS ship frequently; the scorecard is dated and pinned, and stale within months.
- **±1 point is noise.** Anchoring + a single calibrator + refuters make deltas ≥ 2 meaningful; adjacent scores are not a verdict.
- **The repo is public.** `docs/` ships with an MIT open-source repo, and this audit numerically rates named commercial products. It will be factual and cited, but it is outward-facing content — placement is a maintainer decision (§12, decision 6).

## 12. Decisions the maintainer owns

| # | Decision | Recommendation |
|---|---|---|
| 1 | Roster — approve/trim (XCS in Tier 1? VCarve vs Fusion as CNC ceiling?) | Keep as proposed: XCS in (it owns the hardware brands our catalog targets); Fusion stays Tier 3 |
| 2 | Persona weights (§6) | Approve as proposed; adjust if P3's laser-centric skew is wrong |
| 3 | Hands-on availability — can you run LightBurn / MillMage / Easel for contested categories? Licenses? | Even 1–2 hours upgrades the most contested cells from `[OFF]`/`[COMM]` to `[HANDS]` |
| 4 | Rate price/licensing (18.7) or treat as context-only? | Rate it — buyers weigh it, and free+MIT is one of our few structural advantages |
| 5 | Execution shape — one shot vs 3 waves of 6 sectors | Waves, if you want to steer between them; one shot if you want the matrix fastest |
| 6 | Publication location — committed to public `docs/audits/` vs kept private | Commit the methodology + KerfDesk-side findings; decide on the competitor-rating matrix after seeing it |
| 7 | **Go/no-go** on execution | Design is ready; execution starts only on your word |

---

## Appendix A — per-sector report template

```markdown
## S<NN> · <Sector name>

Products rated: <list>; N/R: <list + why>
Pinned evidence: KerfDesk @ <commit>; competitor versions per methodology.md

| # | Category | KerfDesk | LightBurn | MillMage | LaserGRBL | XCS | Easel | <tier-2…> |
|---|----------|----------|-----------|----------|-----------|-----|-------|-----------|
| n.1 | … | 6 [CODE]¹ | 9 [OFF]² | … | | | | |

¹ src/…:Lnn  ² <url>

### State of play
<3–6 paragraphs: how this sector actually compares, what drives the numbers>

### Where we win / where we lose
- WIN n.x (+Δ vs <product>) — <one sentence> [verified: refuter id]
- LOSE n.y (−Δ vs <product>) — <one sentence> → G-S<NN>-<k>

### Gaps feeding the register
<G-S<NN>-1…: one line each>

### Not verified
<explicit list: fidelity cells without PERC, * cells, U cells>
```

## Appendix B — gap-register schema

| Field | Values |
|---|---|
| ID | `G-S<NN>-<k>` |
| Sector.Category | e.g. `6.4 Kerf offset` |
| Versus | Product(s) we trail |
| Delta | Rating gap (ours − best) |
| Severity | **P0** headline-workflow parity gap that loses the sale or is safety-adjacent · **P1** major workflow gap for ≥1 persona · **P2** friction/parity debt · **P3** polish |
| ADR-recorded? | yes (deliberate divergence) / no (un-ADR'd → severity bump per §5.6) |
| Effort | S / M / L (design-level estimate) |
| Recommendation | One sentence; report-only |

## Appendix C — scorecard cell grammar

`<0–10>` integer · `*` = hardware-dependent design-intent rating (§5.4) · `[TAG]` = evidence class (§7) · `U` = unknown, excluded from roll-ups · `N/R` = doesn't compete. Every cell footnotes at least one citation (file:line for KerfDesk; URL/source for competitors).
