# 1 — What we used, and why

Every runtime dependency, its exact version in this tree, and the decision that admitted it.

## The governing dependency policy

**ADR-017** (`DECISIONS.md:498`) is the gate: a library must pass license, maintenance, fit,
size, and CVE review before adoption, and **library availability is explicitly not a
scope-expansion trigger** (restated in ADR-006, `DECISIONS.md:296`). GPL-family packages are
rejected outright so distribution options stay open (`PROJECT.md:19`), enforced by
`scripts/check-licenses.mjs` in CI.

The result is a deliberately tiny runtime tree — **10 packages**, read from `package.json`:

| Package | Version in tree | Role | Authority |
|---|---|---|---|
| `react` / `react-dom` | `^18.3.0` | UI | ADR-009 (`DECISIONS.md:352`) |
| `zustand` | `^4.5.0` | State, strict slices | ADR-009 |
| `clipper2-ts` | `2.0.1-17` | The **only** geometry kernel dependency | ADR-098 §2 (`DECISIONS.md:4306`) |
| `three` | `^0.180.0` | 3D relief / cut preview — UI only | ADR-102 (`DECISIONS.md:4555`), an explicit override of ADR-098 §2 |
| `opentype.js` | `^2.0.0` | Text → outlines | ADR-012 (`DECISIONS.md:412`) |
| `dompurify` | `^3.4.12` | SVG sanitization (untrusted input) | ADR-017; `PROJECT.md:355` requires ≥ 3.3.2 |
| `imagetracerjs` | `^1.2.6` | Multi-colour trace fallback, **UI-unreachable** | ADR-123 (`DECISIONS.md:6166`) |
| `electron-updater` | `^6.8.9` | Desktop update feed, **inert** until signing exists | ADR-024/135 |
| `lucide-static` | `^1.23.0` | Icon assets | **UNDECIDED — no ADR** found for this package |

Notable *absences*, each deliberate:

- **No Immer.** The store uses spreads throughout; `produce` must not be imported (CLAUDE.md
  "Mutable state"). Immer is only an optional peer of Zustand and is absent from the tree.
- **No Tailwind, no UI framework.** CSS Modules only (`PROJECT.md:349`).
- **No potrace.** `potrace-wasm` was rejected on GPL grounds; ADR-123 removed the
  potrace-derived backend entirely to clear the MIT-release blocker.
- **No CNCjs dependency.** Read as a protocol *reference* only (ADR-006 verification;
  `src/core/controllers/grbl/streamer.ts:19` cites it as pattern-only, not vendored).

## Why the architecture looks like this

The shape is a direct response to a named failure. **ADR-002** (`DECISIONS.md:239`) records
that LaserForge 1.0 scored well on pipeline correctness but the lived experience was shotgun
surgery — fixes in one module broke others. The recorded verdict: a 9/10 module that breaks
under maintenance is not 9/10. No code carried over.

The four structural countermeasures, all mechanically enforced:

| Countermeasure | Enforcement | Where |
|---|---|---|
| Pure-function pipeline core | ESLint `no-restricted-globals` / `no-restricted-imports` / `no-restricted-syntax` ban I/O, clock, randomness in `src/core/` | CLAUDE.md "Pure core" |
| Strict module boundaries | `eslint-plugin-boundaries` `^6.0.2`; violation fails CI | CLAUDE.md "Imports" |
| File-size limits | ESLint `max-lines` 400 counted lines hard + a 600 raw-line CI backstop | ADR-015, ADR-132 |
| Determinism + invariants | Vitest snapshots on G-code; `fast-check` `^3.22.0` property tests | ADR-010 |

The layering is one-directional and lint-enforced:

```
core/     → imports core/ only     (pure: no I/O, no clock, no randomness, no console)
io/       → core/, io/
platform/ → core/, platform/types
ui/       → core/, io/, platform/types
```

Two deliberate exceptions: `src/ui/app/main.tsx` is the composition root and may wire
`platform/web` → `ui` (ADR-011); test files and `src/__fixtures__/` are exempt so a test may
import across modules for scaffolding.

One boundary rule is **review-enforced only, not mechanical**: "cross-module imports must go
through `index.ts`". Because elements are declared in folder mode, a deep path like
`../scene/internal/foo.ts` still classifies as its top-level module and passes lint
(CLAUDE.md "Imports"). Reaching into another module's internals will not fail CI.

## Why GRBL is the centre of gravity

**ADR-006** (`DECISIONS.md:296`) fixed the MVP on GRBL v1.1+ only, with `OutputStrategy` as
the seam for later families. The wire authority is the `gnea/grbl` wiki — **archived since
August 2019** (`PROJECT.md:570`). Actively maintained protocol-compatible forks are grblHAL,
FluidNC, and µCNC.

This matters for cross-referencing: our protocol reference is frozen, so where LightBurn or
Easel behave differently on a modern fork, *they* may be tracking upstream while we track the
archive. Treat every controller-behavior divergence as suspect in **our** favour only after
reading that fork's own documentation.

## Language and type strictness

TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
(`PROJECT.md:348`). `any` is banned. Non-null assertions (`!`) are banned outside tests. State
that can be in N states is a discriminated union with `assertNever` in the default arm, so a
new variant becomes a compile error at every switch — this is how new `SceneObject` kinds and
new controller families land without silent gaps (ADR-014, ADR-094).

---

## Cross-reference slot — Phase 2

Answer each from LightBurn / Easel / Carbide Create documentation:

1. **Geometry kernel.** What does LightBurn use for offsetting and booleans, and does it apply
   kerf/tool compensation at the same pipeline stage we do (ours is compile-time,
   `src/core/geometry/kerf-offset.ts`)?
2. **Controller breadth.** LightBurn supports Ruida, Trocen, TopWisdom, galvo. We ship the GRBL
   family + Marlin + Smoothieware + experimental `.rd`. Which of their *dialect* behaviours
   (not device count) reveal a defect in ours?
3. **Archived-protocol risk.** Does LightBurn target grblHAL/FluidNC extensions we ignore
   because the 1.1h archive predates them?
4. **Startup/shutdown block policy.** Does LightBurn let the user edit the preamble/postamble?
   We hard-code it (`PROJECT.md:493`) — is that a parity gap or a safety advantage?
