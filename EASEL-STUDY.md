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

**Depth-per-pass and feed defaults: NOT YET RESEARCHED against official docs.** Forum examples exist
(e.g. a 1-inch surfacing bit at feed 32 / plunge 9 / depth-per-pass 0.04 in; another at 1016 mm/min /
228.6 mm/min / 1.6 mm) but these are user reports, not vendor defaults, and are useless for comparing
against our material-picker numbers (ADR-111/112). Settle by reading Easel's material presets in-app.

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
