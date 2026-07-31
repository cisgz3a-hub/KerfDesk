# KerfDesk architecture reference — laser + CNC

**Purpose.** One code-grounded description of how the whole machine chain works, for both
laser and CNC, written so it can be laid *beside* LightBurn and Easel/Carbide documentation
and diffed. Phase 1 (this set) is the baseline. Phase 2 fills the comparison slots once the
competitor docs are pulled.

**Written:** 2026-07-25. **Tree:** branch `claude/cnc-laser-docs-ed6e91`, clean at write time.

---

## Evidence rules for this document set

These docs follow CLAUDE.md "no invention". Every factual claim is one of:

| Marker | Meaning |
|---|---|
| `file.ts:12` | Read in the current tree at that line. Clickable. |
| ADR-nnn | Quoted or summarized from `DECISIONS.md` at the cited line. |
| version from lockfile | Read from `package.json` in this tree. |
| **UNVERIFIED** | Stated in the tree (comment/ADR) but *not* provable in this session. |
| **NOT VERIFIED PERCEPTUALLY** | Tests assert structure/determinism only — never that output looks right. |
| **HARDWARE CLAIMED** | Code + tests landed; never cut on a real machine. |

Where an ADR does not exist for a design choice, the doc says **UNDECIDED — no ADR** rather
than inventing a rationale. That is a finding, not a gap in the writing.

---

## Read order

| # | File | Covers |
|---|---|---|
| 1 | [01-stack-and-why.md](01-stack-and-why.md) | Every runtime dependency, its version, and the ADR that admitted it |
| 2 | [02-pipeline-spine.md](02-pipeline-spine.md) | The shared chain: design → scene → compile → emit → transport |
| 3 | [03-coordinates-and-origin.md](03-coordinates-and-origin.md) | Scene frame vs machine frame, the five origins, handedness |
| 4 | [04-laser-chain.md](04-laser-chain.md) | Line / Fill / Image, power modes, laser-off invariant |
| 5 | [05-cnc-chain.md](05-cnc-chain.md) | Z model, depth passes, motion polish, climb/conventional |
| 6 | [06-controllers-and-transport.md](06-controllers-and-transport.md) | Driver seam, dialects, character-counted streaming |
| 7 | [07-frame-permit-model.md](07-frame-permit-model.md) | Frame-first Start authorization — the only guard |
| 8 | [08-invariants-and-verification.md](08-invariants-and-verification.md) | What is proven, how, and what is *not* |
| 9 | [09-weakness-register.md](09-weakness-register.md) | Known-weak / unproven + the Phase 2 comparison grid |
| 10 | [10-executable-plan-mathematical-contract.md](10-executable-plan-mathematical-contract.md) | Versioned motion truth, parity laws, dynamics/routing stages, and qualification boundary |

---

## Phase 2 — how to use this against LightBurn and Easel

Every subsystem doc ends with a **`## Cross-reference slot`** block holding the explicit
questions a competitor doc must answer. Do not rewrite these docs during Phase 2 — fill the
slots, then classify each answer into [09-weakness-register.md](09-weakness-register.md):

| Verdict | Meaning | Action |
|---|---|---|
| **PARITY** | We match the reference. | Record and move on. |
| **DIVERGENCE (ADR)** | We differ, deliberately, under a cited ADR. | Confirm the ADR still holds. |
| **DIVERGENCE (unintentional)** | We differ with no ADR authority. | **This is a bug** (ADR-027). File it. |
| **OUR ADVANTAGE** | We do something the reference cannot. | Record; protect it in tests. |

ADR-027 (`DECISIONS.md:1272`) is the governing rule: a divergence is a defect by default,
to be redesigned toward LightBurn rather than defended as a design choice.

### Blocking problem for Phase 2 — read before pulling competitor docs

ADR-027 names **`LIGHTBURN-STUDY.md`** as the authoritative LightBurn behavior reference
(`DECISIONS.md:1293`) and as the running divergence ledger (`DECISIONS.md:1295`).
`src/core/output/grbl-strategy.ts:13` also cites "LIGHTBURN-STUDY §8" to justify our G-code
preamble divergence.

**That file does not exist in this repo.** Verified by repo-wide glob, 2026-07-25. It was
already recorded as missing in
[docs/audits/2026-07-10-implementation-plan.md:512](../audits/2026-07-10-implementation-plan.md)
as finding **GCO-08**, and is still unresolved.

Consequence: the "divergence is a defect" rule is currently **unauditable**, and at least one
shipped divergence (`M3 S0` pre-arm in the laser preamble) cites a source nobody can read.
Rebuilding that ledger *is* Phase 2's first deliverable — see
[09-weakness-register.md](09-weakness-register.md) W-01.

---

## What this document set is not

- **Not a user manual.** Operator flows live in `WORKFLOW.md`.
- **Not a scope document.** Phases and non-negotiables live in `PROJECT.md`.
- **Not a decision record.** Rationale lives in `DECISIONS.md`; these docs *cite* it.
- **Not proof anything works.** See [08-invariants-and-verification.md](08-invariants-and-verification.md)
  for honest verification status. The suite proves structure and determinism. It has never
  proven fidelity, and most of the CNC surface has never touched material.
