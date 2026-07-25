# EASEL-STUDY.md — Easel / Carbide behavior reference and CNC divergence ledger

The CNC counterpart to [LIGHTBURN-STUDY.md](LIGHTBURN-STUDY.md). LightBurn is our laser reference
(ADR-027); Easel is the reference ADR-105 named for the CNC "Easel-parity pack"
(`DECISIONS.md:4727`), and `src/core/output/cnc-grbl-strategy.ts:117` already cites Easel's
post-processor ordering as justification for our own.

**Rebuild started:** 2026-07-25. **Status: FIRST PASS** — sections marked **NOT YET RESEARCHED** have
no entries. Do not read an empty section as parity.

---

## Provenance rules

| Marker | Meaning |
|---|---|
| **[Easel-doc]** + URL | Fetched from the official Easel Support Center (`support.easel.com`) |
| **[Easel-doc via search]** + URL | Official support article, but content relayed by the **search index** — `support.easel.com` returns **HTTP 403** to direct fetches, so the page was not read in full. Stronger than forum, weaker than a page read end to end. Quotes are as the index returned them; re-read in a browser before treating any figure as exact. |
| **[Easel-forum]** | Community forum — **weak**. Community consensus, not vendor behavior. Upgrade before acting. |
| **NOT YET RESEARCHED** | No source pulled. |

Important caveat found while researching: **Easel has no deep public G-code/post-processor
documentation** comparable to LightBurn's Device Settings pages. Its support site is task-oriented
("how to carve"), not reference-oriented. Several questions in our grid may only be answerable by
generating G-code from Easel and reading it. Where that is true, this file says so rather than guessing.

Domain note: `discuss.inventables.com` → `forum.easel.com` → `community.inventables.com` (302 then
301). Official help is `support.easel.com/hc/en-us/...`.

---

## §1 — Work coordinates and Z zero

**[Easel-doc]** https://support.easel.com/hc/en-us/articles/4413288405395-Work-Zero-and-Homing
· https://support.easel.com/hc/en-us/articles/5360405175187-Using-the-Z-Probe (both 2026-07-25)

| Easel behavior | Ours | Verdict |
|---|---|---|
| **Total depth carved is measured from the top surface of the material.** Z work zero sits at material top. | `Z0 = stock top`, operator zeros the bit on the stock (`cnc-grbl-strategy.ts:11-12`) | **PARITY** |
| **XY work zero is set manually by jogging to the front-left corner of the material.** | `front-left` is our origin default; Set Origin (ADR-021) + Capture Board Corners (ADR-124) do exactly this | **PARITY** |
| Z-probe computes zero from a **brass puck of known thickness** | Probing wizard, Z + XYZ corner, `G38.2` (ADR-103 H.11); plate geometry validated by ADR-188 | **PARITY, ours broader** |
| Work zero drawn as a purple `0,0,0` point on the grid | Canvas origin markers (ADR-197) | PARITY |

This closes two rows of the [09-weakness-register](docs/architecture/09-weakness-register.md) grid and
answers the open question in
[03-coordinates-and-origin.md](docs/architecture/03-coordinates-and-origin.md) cross-reference item 5:
**Easel is stock-top referenced, same as us.** No divergence, no usability gap.

## §2 — Cut direction (climb vs conventional)

The section that matters most, because ADR-251 made **climb** our default for profile cuts and
[W-02](docs/architecture/09-weakness-register.md) flags a possible origin-dependent sign inversion.

**Finding: no Easel setting for cut direction could be located.** Neither the support site nor the
community thread on the topic references an Easel control for it. **NOT PROVEN ABSENT** — absence of
documentation is not documentation of absence — but there is no evidence Easel exposes it.

**[Easel-forum]** https://community.inventables.com/t/climb-versus-conventional-cutting/10334
(2026-07-25) — the thread discusses climb vs conventional generically and records a community
consensus that **conventional cutting is typically preferred on smaller machines like the X-Carve,
because climb cuts cause chatter**.

That is a weak source, but it is directly adverse to one of our shipped defaults, so state it plainly:

> **ADR-251 made climb the default for profile cuts. The community consensus for the machine class we
> actually target — small hobby routers, of which the maintainer's Neotronics 4040 is one — is that
> conventional is preferred on exactly these machines, because of chatter.**

This is a **separate concern from W-02's sign question** and does not depend on it. W-02 asks *"does our
climb flag produce the direction we think it does?"* This asks *"is climb the right default on a small
machine at all?"* Both need the same coupon to settle, so the coupon should cut four combinations:
climb and conventional, on two origins.

See §5 D-11.

## §3 — Feeds, speeds, and depth per pass

**Feed-rate override:** Easel adjusts feed **and plunge** in real time, **±10% per button click**, on
both Easel-generated and imported G-code
(https://discuss.inventables.com/t/feed-rate-override-available-for-all-easel-users/49058 — an official
Inventables "Updates" post, so stronger than ordinary forum content but not support documentation).

Ours: real-time feed/spindle/rapid overrides (ADR-103 H.11). Our project memory already records the
underlying constraint — **GRBL has no plunge-only override; the feed override scales both** — and that we
ship more than Easel here. Easel's ±10%-per-click behavior is consistent with that constraint, so this
corroborates the earlier finding rather than contradicting it.

### Depth per pass — Easel publishes a hard rule, we have none

**[Easel-doc via search]** *Cut Depth and Depth Per Pass*
(https://support.easel.com/hc/en-us/articles/360015957214-Cut-Depth-and-Depth-Per-Pass):

> "As a general rule, your depth per pass should never exceed half the diameter of your bit. For
> example, the depth per pass for a 1/4" (.25") bit should not exceed .125" per pass, the depth per pass
> for a 1/8" bit (.125") should not exceed .0625" per pass."

So Easel's rule is **depth-per-pass ≤ bit diameter ÷ 2**.

**Ours: no such relationship exists anywhere.** Verified:

- `zPassDepths` (`src/core/cnc/depth-passes.ts:11-15`) clamps only to the total depth
  (`Math.min(depthPerPassMm, depthMm)`).
- Neither `depth-passes.ts` nor `feeds-calculator.ts` references `diameterMm` at all.
- `cnc-preflight.ts:129` checks only `settings.depthPerPassMm > 0`.

**Our shipped starter does comply**, comfortably: the 4040 starter uses
`NEOTRONICS_4040_DEPTH_PER_PASS_MM = 0.75` mm (`cnc-machine-starter-catalog.ts:50`) on
`DEFAULT_END_MILL_DIAMETER_MM = 3.175` mm (1/8") — that is 24% of diameter, against a 50% ceiling. The
gap is that **a user-entered value has nothing checking it.** See §5 D-13.

**Feed defaults still NOT YET RESEARCHED** against official per-material presets. Forum examples exist
(a 1-inch surfacing bit at feed 32 / plunge 9 / depth-per-pass 0.04 in; another at 1016 mm/min /
228.6 mm/min / 1.6 mm) but those are user reports, not vendor defaults, and are useless for comparing
against ADR-111/112 numbers. Settle by reading Easel's material presets in-app.

### Bit guidance

**[Easel-doc via search]**: "any end mill bit ¼" or ⅛" diameter will work well as a roughing bit; for
the finishing pass, we strongly recommend using a ⅛" ballnose bit."

Matches our relief finishing design — ADR-098 H.8 is a ball-nose max-plus tip surface with
scallop-driven stepover. **PARITY on the tooling model.**

## §4 — Two-stage carves, 3D, and other features

**[Easel-doc]** Easel has **Two-Stage Carves (roughing and detail)**
(https://support.easel.com/hc/en-us/articles/360012453174-Two-Stage-Carves-Roughing-and-Detail-Carves),
**3D carving in Easel Pro**
(https://support.easel.com/hc/en-us/articles/10369535844243-3D-Carving-Instructions), and **Cutting
from the Center** (https://support.easel.com/hc/en-us/articles/360034683854-Cutting-from-the-Center).

| Easel | Ours |
|---|---|
| Two-stage roughing + detail | Finish allowance + finishing pass (ADR-140); two-tool rest machining (ADR-153) |
| 3D carving (Pro tier) | Relief roughing/finishing (ADR-098 H.4/H.5/H.8), STL heightmap |
| Cutting from the center | `center` origin (`origin-transform.ts:64`) |

Feature-existence findings only — not yet compared in behavioral detail.

## §5 — Divergence ledger (CNC)

Continues LIGHTBURN-STUDY.md's numbering to keep one namespace across both references.

### D-08 — Z zero and XY zero conventions match Easel · **PARITY**

Stock-top Z and front-left XY. No action. Recorded so it stops being an open question.

### D-09 — Lift-before-spindle parity claim · **UNVERIFIED**

`cnc-grbl-strategy.ts:117-118` asserts "Easel's post lifts first, then M3". The *reasoning* is sound
regardless (starting a spindle with the bit resting on stock can grab), but **the claim about Easel is
still uncited**. Easel publishes no post-processor reference, so this can only be settled by generating
a carve in Easel and reading the emitted preamble.

Same defect class as LIGHTBURN-STUDY D-03: a comparative claim in a code comment with no source.

### D-10 — Easel exposes no cut-direction control · **OUR ADVANTAGE (probable)**

If confirmed, exposing climb/conventional (ADR-251, ADR-252) is a capability Easel lacks. But see D-11
before treating it as a win.

### D-11 — Our climb default may be wrong for our target machine class · **P1, needs the coupon**

ADR-251 defaults profile cuts to climb. Community consensus for small hobby routers is conventional,
because climb induces chatter on machines with limited rigidity. Combined with **W-02** (possible
origin-dependent sign inversion), the shipped default may be both *the wrong choice* and *not the choice
we think it is*.

**Recommended coupon design** (not yet run): one outer profile plus one interior hole, cut four times —
climb and conventional, on `front-left` and on `rear-left`. That single test settles W-02's sign question
and D-11's default question together, and it is the highest-value physical test outstanding anywhere in
this repo.

### D-12 — Feed override scope · **PARITY, ours broader**

Easel: ±10% per click on feed and plunge. Ours: feed, spindle, and rapid overrides (ADR-103).
Corroborates the known GRBL constraint that plunge cannot be overridden independently.

### D-13 — No depth-per-pass vs bit-diameter advisory · **GAP, rule-7 compatible**

Easel publishes **depth-per-pass ≤ bit diameter ÷ 2** (§3). We relate the two nowhere:
`depth-passes.ts:11-15` clamps only against total depth, `feeds-calculator.ts` never reads
`diameterMm`, and `cnc-preflight.ts:129` only checks the value is positive. An operator can set 6 mm
per pass on a 3 mm bit and we will emit it.

Our own starter is conservative and compliant (0.75 mm on a 3.175 mm bit = 24%), so this is not a
shipped-defaults defect — it is a missing advisory for hand-entered values.

**This belongs in Job Review as a warning, never as a block** (CLAUDE.md rule 7, PROJECT.md #21). A
depth-per-pass judgement is exactly the "policy finding" class that may inform and must not refuse.
Cheap to add, and it is the kind of advisory that protects a bit and a workpiece.

### D-14 — Tabs: Easel auto-adds on full-depth cutouts · **DIVERGENCE in trigger, needs check**

**[Easel-doc via search]** *How To Use Tabs*
(https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs): tabs are **added
automatically when the cut depth of an outline shape equals the material thickness**, and with a
full-depth cutout the operator can edit "Use Tabs" to reposition them — explicitly so tabs can be kept
away from corners and delicate areas.

Ours: automatic Line-mode hard-skip tabs (`core/geometry/tabs-bridges.ts`) plus ADR-156 persisted
drag-placeable anchors for closed CNC profiles. So we have both mechanisms, but **the automatic
*trigger* differs**: Easel keys off "cut depth == material thickness", i.e. it infers a through-cut.

**Now verified, and it is a real gap:**

- **CNC tabs default OFF** — `tabsEnabled: false` in the CNC machine defaults
  (`src/core/scene/machine.ts:309`), and likewise for laser layers (`src/core/scene/layer.ts:92`).
- **No through-cut detection enables them.** `cnc-tabs.ts:56` states the intent — "CNC tabs go on every
  through-cut contour" — but that applies once tabs are *already* enabled; nothing infers a through-cut
  from depth vs material thickness to switch them on.
- **Job Review does surface the state, but only as a neutral fact.**
  `job-review-detail-facts.ts:107` renders the literal string `'tabs off'`. The operator is told; they
  are not warned, and the fact is not correlated with the through-cut that makes it dangerous.

So an operator who sets a full-depth profile cut and leaves tabs off gets a freed part with no warning.
Easel would have added tabs for them. This is the most concrete safety-relevant parity gap found in the
Easel pass.

### D-14a — Tabs cannot be defaulted ON yet: they disable ADR-250 leads · **P1 BLOCKER**

The maintainer asked for tabs default ON (2026-07-25). It was implemented, tested, and **reverted the
same session** because it breaks a shipped safety feature. Evidence — 10+ failures across
`compile-cnc-climb-default`, `compile-cnc-job`, `compile-cnc-lead`, and `compile-cnc-line-art`, the
decisive one being `expected 'contour' to be 'path3d'`:

**Mechanism — corrected 2026-07-25.** An earlier revision of this entry blamed pass ordering (tabs split
the loop, then leads only see open passes). That is wrong, and the real cause matters more:

`applyProfileLeadPasses` contains an **explicit early return** (`profile-lead-passes.ts:44-48`):

```js
if (settings.rampEntryDeg !== undefined) return passes; // ramp owns the entry
// Tabs split the loop into open segments; a lead on the surviving full loops
// while the split passes still plunge on the wall would be inconsistent, so a
// tabbed profile keeps the legacy entry. Tab-aware leads are a follow-up.
if (settings.tabsEnabled) return passes;
```

So **leads never run when tabs are enabled** — deliberately, and ADR-250's own header records it: tabs
"fall back to the legacy straight plunge" (`profile-lead-passes.ts:18-20`). The interaction was known and
deferred by ADR-250's author, and the deferral is ADR-sanctioned rather than a defect.

Consequence for the default flip is unchanged and still blocking: **tabs on ⇒ no leads**, so a
tabs-by-default world reverts every profile cut to a square full-depth plunge on the wall — exactly what
ADR-250 was written to eliminate. But the remedy is **not** a reordering. Reordering changes nothing while
that early return stands; what is required is the "tab-aware leads" follow-up the comment names.

Secondary effects of the flip, both inherent to tabs rather than bugs, but material at the shipped
defaults (`tabHeightMm: 2`, `tabWidthMm: 6`, `tabsPerShape: 4`, 3.175 mm bit):

- Total skipped perimeter is `4 × (6 + 3.175) = 36.7 mm`. On a contour whose perimeter is shorter than
  that — a hole under ~11.7 mm diameter — the documented degenerate path (`cnc-tabs.ts:10-13`, AUDIT A5)
  skips the deep pass entirely, so **small holes stop cutting through**.
- When `depthMm ≤ tabHeightMm` (≤ 2 mm), `tabTopZMm` returns 0 and `passNeedsTabs` is true for every
  pass, so a shallow profile groove gets four uncut gaps. Logically consistent — a tab taller than the
  cut means "don't cut here" — but surprising as a default.

**Prerequisite before the default can flip: implement tab-aware leads.** Three candidate designs, none
of them a reordering:

1. **Lead every split piece.** Each open piece gets a waste-side lead-in at its start and lead-out at its
   end. Most faithful to ADR-250's intent, and the most work: `computeProfileLead` is written against a
   closed `Polyline` and its waste-side/self-collision guards (`leadClearsPart`,
   `leadClearsSiblings`) assume a full loop, so open-piece semantics have to be defined rather than
   inherited. Piece count multiplies lead count, so bed-fit and sibling-collision rejections get more
   frequent and need a defined fallback per piece.
2. **Ramp each split piece instead.** `applyRampEntry` already handles open contours, so a tabbed profile
   could descend along the path rather than plunge. Cheaper geometrically, but `applyRampEntry` tracks
   `previousZ` across a depth ladder (`motion-polish.ts:114-131`) and sibling pieces sharing one Z break
   that assumption — it would need a per-piece variant.
3. **Lead only the first piece.** Cheapest; explicitly rejected by the existing comment as
   "inconsistent", and rightly so — the remaining pieces still plunge on the wall.

(1) is the correct target, (2) is the pragmatic one. Either needs its own ADR, its own diff, and — because
both change real machine motion at full depth — a coupon before being trusted. Also re-evaluate the two
secondary effects above, likely by scoping tabs to passes that genuinely reach through-depth.

Until then the correct remedy for D-14 remains the **Job Review warning**: when a profile cut's depth
reaches or exceeds material thickness and tabs are off, inform the operator. Rule 7 permits informing
only — and note that Easel's silent auto-enable would additionally have hit this same lead-disabling
interaction.

### D-15 — Roughing/finishing bit model · **PARITY**

Easel: ¼" or ⅛" end mill to rough, ⅛" ballnose to finish. Ours: ADR-098 H.8 ball-nose finishing with
scallop-driven stepover, two-tool sections (ADR-153). Same model.

---

## Next actions, in order

1. **Cut the D-11 / W-02 coupon.** Four cuts, two origins, two directions. Settles the only
   safety-relevant open question in the CNC chain.
2. **Generate G-code from Easel and read it.** Easel has no post-processor reference, so preamble
   ordering (D-09), depth-per-pass defaults, and any cut-direction behavior can only be recovered from
   real output. One exported `.nc` answers several grid rows at once.
3. **Read Easel's material presets** to compare against ADR-111/112 numbers.
4. Then Carbide Create as a second CNC reference — it has better public documentation than Easel and may
   answer D-09 by analogy.

## Sources

- [Work Zero and Homing](https://support.easel.com/hc/en-us/articles/4413288405395-Work-Zero-and-Homing)
- [Using the Z-Probe](https://support.easel.com/hc/en-us/articles/5360405175187-Using-the-Z-Probe)
- [Two-Stage Carves](https://support.easel.com/hc/en-us/articles/360012453174-Two-Stage-Carves-Roughing-and-Detail-Carves)
- [3D Carving Instructions](https://support.easel.com/hc/en-us/articles/10369535844243-3D-Carving-Instructions)
- [Cutting from the Center](https://support.easel.com/hc/en-us/articles/360034683854-Cutting-from-the-Center)
- [Start Carving in Easel](https://support.easel.com/hc/en-us/articles/360012848233-Start-Carving-in-Easel)
- [Climb versus Conventional cutting](https://community.inventables.com/t/climb-versus-conventional-cutting/10334) — [Easel-forum]
- [Feed rate override available for all Easel users](https://discuss.inventables.com/t/feed-rate-override-available-for-all-easel-users/49058) — Inventables Updates post
