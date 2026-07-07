# RUBRIC.md — Audit checklist applied to every sector

> This rubric is applied to **every file in every sector, on every pass**. Default
> items are never removed. Sector-specific items are added under each sector in
> `SECTORS.md` and cross-referenced here. No finding is recorded without evidence
> (file path + line/function + a command output or direct quote).

Audit convention (matches the maintainer's `CLAUDE.md` and the prior
`audit/REPOSITORY-SECTOR-*` corpus): **findings only — product source is never
modified during the audit.** Only files under `audit/` are created/updated.

---

## Severity definitions

| Severity | Meaning | Examples |
|---|---|---|
| **Critical** | Can produce physical harm, a wrong/dangerous machine action, silent data loss, or a security breach. Ship-blocker. | Laser on during travel; G-code exceeds bed; project save corrupts data; sanitizer bypass. |
| **High** | Wrong output or a crash on a realistic path; a stated non-negotiable/invariant is violable; a security control is weak. | Non-deterministic G-code; NaN reaches emitter; unhandled promise rejection on a common flow. |
| **Medium** | Incorrect on an edge case, degraded UX, or a maintainability hazard that will cause future bugs. | Off-by-one on empty input; god file over the code-line limit; hidden coupling. |
| **Low** | Minor correctness/clarity issue with limited blast radius. | Dead code; misleading name; missing narrow edge-case handling. |
| **Info** | Not a defect; a documented observation, drift note, or verification-gap worth recording. | Doc/code drift; unverified hardware claim; test asserts structure not fidelity. |

**Fidelity caveat (project-specific, from `CLAUDE.md` rule 2):** green tests prove
*structure and determinism*, never *fidelity* (does the trace/fill/engrave/raster
look like the source?). Any "works" claim about a visual feature that rests only on
`pnpm test` is itself an Info finding until perceptually verified.

---

## Default rubric (all 22 — applied to every file)

1. **Correctness bugs** — does the code do what its name/contract says?
2. **Broken logic** — control flow, branch conditions, loop bounds, operator precedence.
3. **Bad assumptions** — implicit invariants that inputs can violate (non-empty, sorted, in-range, finite).
4. **Error handling gaps** — swallowed errors, `catch {}`, missing `Result` handling, unvalidated returns.
5. **State management problems** — stale state, mutation-after-construction, Zustand slice misuse, undo/redo integrity.
6. **Async/concurrency problems** — floating promises, races, missing `await`, lifecycle/cleanup (listeners, ports, timers).
7. **File/path issues** — path separators (win32 vs POSIX), FS Access API misuse, extension handling.
8. **API/data-contract mismatches** — caller/callee shape disagreement, schema-vs-runtime drift, discriminated-union arms unhandled.
9. **Security risks** — untrusted SVG/raster/DXF/STL/G-code parsing, Electron trust boundary, CSP, `eval`-like sinks.
10. **Input validation problems** — unbounded sizes, NaN/Infinity, malformed files, negative dimensions.
11. **Permissions/auth issues** — serial/FS/camera permission handlers, Electron `setPermissionRequestHandler`.
12. **Dependency risks** — license (MIT-compat per ADR-017), CVEs, pinning, bundle-size budget, unmaintained.
13. **Performance bottlenecks** — quadratics on scene/pixel scale, redundant recompute, main-thread blocking, budget breaches.
14. **Dead code** — unreachable branches, unused exports, orphaned files not imported anywhere.
15. **Duplicated logic** — same computation in ≥2 places (copy-paste divergence risk).
16. **Poor separation of concerns** — one-sentence-with-"and" files, mixed responsibilities.
17. **God files** — approaching/over the counted-code limits (250 soft / 400 hard code lines; 600 raw backstop; 250 component; 80 function; complexity 12).
18. **Hidden coupling** — cross-module reach-through, ordering dependencies, shared mutable state, boundary violations.
19. **Build/test/lint problems** — failing or flaky checks, missing sibling tests, snapshot integrity, CI gaps.
20. **Edge cases** — empty/single/huge inputs, degenerate geometry, zero/negative/overflow, unicode, transparency.
21. **Regression risk** — how likely a future change here breaks something else; blast radius.
22. **User-facing failure risk** — does a fault reach the operator as a wrong cut, silent failure, or unrecoverable state?

---

## Project-specific invariant checks (from `PROJECT.md` Non-negotiables 1–9)

Apply wherever a file touches geometry, compilation, or output:

- **I1 Bounds** — generated paths fit inside configured bed.
- **I2 Origin honesty** — output coords match device profile origin.
- **I3 Laser-off on travel** — every `G0` ends with `S0` or precedes `M5` (property-tested).
- **I4 No partial output** — pipeline failure writes no file / sends no stream.
- **I5 Deterministic G-code** — same input+params → byte-identical (snapshot-tested).
- **I6 Units honest** — internal mm; inches only at import boundary.
- **I7 Power scale honest** — `S` matches device `$30` max-power scale (property-tested).
- **I8 No telemetry/network** — local-first, ever.
- **I9 E-stop reachable** — Stop reachable from any window state; no modal blocks it.

CNC additions (ADR-098): Z-up safe-retract invariant; overdeep-cut invariant.

---

## Per-sector rubric add-ons

Recorded here as they are defined during each sector's Step 2. Initial allocation:

- **S01** governance: ADR numbering integrity; doc/code drift; claim-vs-verification honesty ("Built" vs hardware-verified).
- **S02** tooling: CI gate completeness (does `release:check` run every guard?); file-size policy authority; license-checker coverage; deploy branch correctness.
- **S03** electron: trust-boundary hardening as literal config; serial/permission handler scope; bridge input validation.
- **S04** core-domain: purity (no `Date.now`/`Math.random`/`window`/IO in `core`); clipper2 NaN/degenerate exposure; union exhaustiveness (`assertNever`).
- **S05** job/output: all 9 invariants; trace outline-vs-centerline fidelity gap; raster emit power modulation; determinism.
- **S06** io: clean-room parser claims; SVG/DXF/STL/G-code untrusted-input safety; `.lf2` migration correctness.
- **S07** platform: WebSerial connect/disconnect lifecycle; adapter interface conformance; PWA update semantics.
- **S08** ui: E-stop reachability; state-slice discipline; render performance; component-size limits; side-effect-free verification discipline.
- **S09** fixtures: does the harness assert fidelity or only structure/IoU? simulator realism; malicious-SVG corpus coverage.

---

## Verifier-pass questions (Step 5, every sector)

1. Is this actually a defect, or expected behavior I misread?
2. Is there direct evidence (line + command/quote), or am I inferring?
3. Did I misunderstand the architecture or a boundary?
4. Is it already handled in another file/layer?
5. Is severity calibrated (not inflated, not buried)?
6. Could it be a false positive (test-only code, unreachable, guarded upstream)?
7. Is the suggested fix direction safe and non-speculative?
8. Did I miss a more serious issue in the same file?
