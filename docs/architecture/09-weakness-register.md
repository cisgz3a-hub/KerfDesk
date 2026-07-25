# 9 — Weakness register and Phase 2 grid

Where to press hardest when the LightBurn and Easel documentation arrives.

Everything here is carried forward from evidence in the tree, prior audits, or project memory. Nothing
here was fixed in this session — this document set is **audit-only** per CLAUDE.md rule 1.

## Ranked weaknesses

### W-01 — The LightBurn reference document did not exist · **PARTIALLY RESOLVED 2026-07-25**

> **Update.** `LIGHTBURN-STUDY.md` now exists at the repo root, rebuilt from fetched LightBurn
> documentation. §§1–4 (device/G-code settings, layer modes, image/dither, power modes) and the §8
> divergence ledger are populated; §§5–7 (framing, optimization, trace) are still **NOT YET RESEARCHED**.
> Seven ledger entries are open, including **D-03**, which reclassifies our `M3 S0` preamble pre-arm as a
> shipping divergence with **no ADR**. Original finding retained below for context.

ADR-027 (`DECISIONS.md:1272`) makes LightBurn canonical and declares **`LIGHTBURN-STUDY.md`** the
authoritative behavior reference (`:1293`) and the running divergence ledger (`:1295`).
`src/core/output/grbl-strategy.ts:13` cites "LIGHTBURN-STUDY §8" to justify the `M3 S0` preamble
divergence.

**The file does not exist anywhere in the repo.** Verified by repo-wide glob, 2026-07-25. Already
recorded as **GCO-08** in `docs/audits/2026-07-10-implementation-plan.md:512`, unresolved since.

Consequence: ADR-027's "a divergence is a defect unless the ledger records it" rule is unauditable, and
at least one shipped divergence cites an unreadable source. **Rebuilding this ledger is Phase 2's first
deliverable** — this document set is deliberately structured to become its skeleton.

### W-02 — Possible CNC climb-direction inversion on three of five origins · **P1, safety-adjacent**

`enforceCutDirection` (`src/core/cnc/motion-polish.ts:39`) decides climb vs conventional from shoelace
signed area computed on **machine-space** polylines (`compile-cnc-job.ts:68`). Mirroring one axis flips
that sign, and `front-left`, `rear-right`, and `center` each apply an odd number of axis flips. ADR-251
made climb the **default**, so this runs on ordinary jobs, and ADR-250 lead placement reads the same
winding — so a sign error propagates into lead geometry.

Full analysis: [03-coordinates-and-origin.md](03-coordinates-and-origin.md).
**Status: UNVERIFIED. Cut a two-feature coupon before trusting climb output.**

### W-03 — Fidelity is unmeasured across the whole output surface · **P1, systemic**

The suite asserts structure and determinism, never appearance
([08](08-invariants-and-verification.md)). The one perceptual harness (ADR-025) uses IoU, documented as
blind to the outline-vs-centerline gap (`PROJECT.md:113`) and, per project memory, blind to waviness.
So no automated check would catch a fill hatching at the wrong angle, a raster burning inverted, or a
V-carve cutting the wrong depth law — provided each stayed deterministic.

### W-04 — Nearly all CNC is hardware-CLAIMED · **P1 for anything sold**

`PROJECT.md:138` labels every Phase H sub-phase "Built … hardware pass still CLAIMED". H.15–H.18 (rest
machining, adaptive clearing, inlay pairs, drag tabs) are the least-verified and most mechanically
aggressive code in the repo. The 2026-07-05 CNC release audit concluded **not sellable** with 7
hand-confirmed criticals and 34 unverified majors.

### W-05 — Four size/quality rules read as enforced but are not · **P2**

React component ≤ 250 lines, cross-module imports through `index.ts`, `Result`-instead-of-`throw` in
`core/`, and sibling-test presence are all **review-only** ([08](08-invariants-and-verification.md)).
Assume drift. `cnc-grbl-strategy.ts` at 442 raw lines and `compile-cnc-job.ts` at 424 already sit above
the 400 *counted*-line comfort zone — they pass only because comments and blanks are excluded.

### W-06 — Guard drift between ADR text and rule 7 · **P2, governance**

Project memory records **4 P1 guard-drift ADRs** outstanding from the 2026-07-25 markdown audit: ADR
text describing guards that contradict CLAUDE.md rule 7. Code is the authority; the ADRs have not caught
up. Any agent reading only `DECISIONS.md` may reintroduce a forbidden guard in good faith — which is
exactly how the 22 unauthorized guard PRs happened.

### W-07 — ADR-172's classification is arguable · **P2**

Blocking CNC Start on missing work Z is filed as handoff consistency (category c). Defensible, but close
to a policy judgment, and #21 explicitly forbids relabeling policy as a factual category. Worth an
explicit maintainer ruling rather than leaving it implicit.

### W-08 — Known open P2s not re-verified this session · **P2**

Carried from project memory; each needs confirmation against the current tree:

- Console `$$` can wedge `controllerOp` — **no timeout** (Super Console audit 2026-07-19).
- Air assist previously emitted nothing in some paths (burn-quality audit 2026-07-17). Current code does
  emit `M7`/`M8`/`M9` transitions (`grbl-strategy.ts:421-431`) but was not traced end-to-end.
- `.lbrn` export drops cut settings.
- `linesPerMm < 1` floor not fixed (CNC lead/ramp audit 2026-07-24).
- Trace `DEFAULT_TRACE_OPTIONS` degenerates on already-binary input (`PROJECT.md:113`).

### W-09 — Ruida is shipped but never accepted by hardware · **P3, scope honesty**

ADR-097 ships `.rd` export with encode→decode round-trip proven and a warning on every export. It has
never been accepted by a real controller. Correctly labeled, but it is a feature in the product that
cannot be claimed to work.

### W-10 — Asymmetries with no ADR · **P3**

- Image overscan is a **fixed 5 mm**, not per-layer, while fill overscan is per-layer
  (`PROJECT.md:403`). **UNDECIDED — no ADR** found for the asymmetry.
- `lucide-static` has no ADR entry despite ADR-017 requiring evaluation of every dependency and
  `PROJECT.md:342` requiring a `RESEARCH_LOG.md` entry for each.
- ADR-054..091 remain **reserved but unused**; several shipped parity features (kerf offset, tabs,
  cross-hatch, offset fill) landed with **no dedicated ADR**, and `PROJECT.md:544` records that earlier
  citations of ADR-052/053 for them were simply **wrong**.

## The Phase 2 comparison grid

Fill one row per subsystem. Verdicts per [README.md](README.md).

| Subsystem | Our behavior (cite) | LightBurn | Easel/Carbide | Verdict | Action |
|---|---|---|---|---|---|
| Preamble / postamble | `M3 S0` pre-arm, `G21 G90 G54 G94` (`grbl-strategy.ts:94`) | | n/a | | |
| Layer identity | Explicit operation IDs (ADR-211) | colour-as-layer | | | |
| Fill overscan | per-layer, short-run bypass (ADR-033) | | n/a | | |
| Scanning offset | per-speed table (ADR-052) | has equivalent | n/a | | |
| Dither algorithms | 3 (`DECISIONS.md:1283`) | 10 | n/a | | |
| Image overscan | fixed 5 mm | | n/a | | |
| Power mode M3/M4 | per-mode + per-layer override (ADR-036/190) | | n/a | | |
| Trace engine | own measured-boundary (ADR-128) | | n/a | | |
| Bitmap DPI default | 254 (ADR-048) | 254 claimed | n/a | | |
| Origin corners | 5 incl. `center` (`origin-transform.ts:49`) | | | | |
| Z zero reference | stock top (`cnc-grbl-strategy.ts:11`) | n/a | | | |
| Climb / conventional | machine-space shoelace (**W-02**) | n/a | | | |
| Hole detection | largest-area winding (`motion-polish.ts:65`) | n/a | | | |
| Ramp entry | opt-in, ≤45° (`motion-polish.ts:114`) | n/a | | | |
| Lead-in / lead-out | arc+line, profile only (ADR-250) | out of scope for laser | | | |
| Tabs | height-based + manual anchors (ADR-156) | n/a | | | |
| Lift-before-spindle | yes, claims Easel parity (`cnc-grbl-strategy.ts:117`) | n/a | | | |
| Tool change | swallow `M0` → Idle (`streamer.ts:39`) | | | | |
| Depth-per-pass default | material picker (ADR-111/112) | n/a | | | |
| Feeds & speeds | `feeds-calculator.ts` (ADR-103) | n/a | | | |
| Rest machining | ADR-153 | n/a | | | |
| Adaptive clearing | ADR-154 | n/a | | | |
| Streaming buffer | char-counted, 120 B (`streamer.ts:27`) | | | | |
| `error:N` handling | terminal (ADR-041) | claimed same | | | |
| Pause | `!` laser / `0x84` CNC (ADR-180 am. 2) | | | | |
| Mid-job reconnect | terminal, no resume | | | | |
| Start authorization | frame-first permit (ADR-228) | | pre-carve checklist | | |
| Out-of-bounds | **warns, never refuses** (ADR-232) | | | | |
| Job time estimate | `estimate-duration.ts`, unverified | | | | |
| Image editing | Image Studio (ADR-242) | **none** | none | **OUR ADVANTAGE** | protect in tests |
| Box generator | ADR-106/116 | none | none | **OUR ADVANTAGE** | fit still CLAIMED |
| Camera alignment | ADR-107–110 | has camera | none | | |

## Recommended Phase 2 sequence

1. **Rebuild `LIGHTBURN-STUDY.md`** from the pulled documentation, using this set as its skeleton
   (W-01). Without it, no divergence verdict is auditable.
2. **Fill the grid** above, one subsystem per sitting, citing the competitor doc for every row.
3. **Triage the DIVERGENCE (unintentional) rows** — those are bugs by ADR-027, and they are the actual
   product of this exercise.
4. **Run the output benchmark** ([08](08-invariants-and-verification.md) item 2). Documentation
   comparison finds design gaps; only output comparison finds fidelity gaps, and fidelity is W-03.
5. **Cut the W-02 coupon.** It is the one item here that can ruin a workpiece, and no amount of reading
   will settle it.
