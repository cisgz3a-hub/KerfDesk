# Design Studio — refined brief (rewritten prompt)

> Written 2026-07-30 in response to a maintainer request whose final item was
> *"make this prompt better before you start."* This file **is** that better
> prompt. It is the governing brief for the work; the research findings,
> implementation plan, and staged build order land in sibling documents.
>
> Original ask, verbatim, so nothing is quietly dropped:
> *"I want to build an in detail design tool for canvas that shapes and pictures
> can be designed by hand directly on canvas. (1) research similar apps (2) check
> all their features and tools (3) read their docs (4) read our canvas and plan an
> implementation plan (5) plan an upgraded version, maybe a three.js version that
> can import directly on the canvas (6) maybe a type of autocad feature that can
> work for lasers, so not totally 3d, but still 3d enough for CNC (7) can be in a
> separate pop up window like our photoshop (8) /goal /workflows (9) build end to
> end (10) make this prompt better before you start."*

---

## 1. What is actually being asked

Today KerfDesk's canvas is a **placement surface**. You import artwork, drag it,
scale it, and assign operations. The drawing tools that exist (Phase G / ADR-051:
rect, ellipse, polygon, star, pen, plus bounded node editing from ADR-159/164)
let you rough something out, but you cannot *design* on it — there is no arc
tool, no trim/extend/fillet, no dimension you can type, no constraint, and no way
to say "this profile is 6 mm deep" and see it.

The ask is to close that: turn the canvas into a place where a real part gets
**drawn by hand, to size, from nothing**, and then cut.

Restating it as one sentence per deliverable:

| # | Deliverable | One-sentence definition |
|---|---|---|
| **D1** | **Design Studio window** | A full-window vector design surface, lazy-loaded and session-isolated exactly like Image Studio is for rasters, that opens on the current scene and commits back into it. |
| **D2** | **Precision drawing tools** | Every creation tool a 2D design tool is expected to have — line, arc (3 ways), circle (radius/diameter/2-point/3-point), rectangle (corner/center/3-point), rounded-rect, slot, polygon, star, ellipse, spline/Bezier, freehand, text — each accepting typed numeric input, not just dragging. |
| **D3** | **Modify operations** | Trim, extend, fillet, chamfer, offset, mirror, rectangular array, polar array, break, join, explode, and the boolean set — the AutoCAD/Inkscape "modify" surface, on top of the clipper2 ops we already have. |
| **D4** | **Precision layer ("the AutoCAD feeling")** | Object snaps (endpoint / midpoint / center / quadrant / intersection / tangent / perpendicular / nearest), ortho + polar tracking, a typed-input command line, dimension annotations, and — the real prize — **dimension-driven editing**: change the number, the geometry moves. |
| **D5** | **2.5D depth model** | A per-profile depth/height property so a closed contour is not just an outline but a *pocket 6 mm deep* or a *boss 6 mm tall* — "not totally 3D, but 3D enough for CNC". |
| **D6** | **Live three.js design view** | The 2.5D model rendered as real solids in the three.js viewer we already ship, with direct import of external geometry (SVG / DXF / STL) placed onto the design plane. |
| **D7** | **Laser-aware, not CNC-only** | Every one of the above must be useful in laser mode too, where depth degenerates to pass-count/power rather than Z — the tool is one design surface for both machines. |

---

## 2. Success criteria — how we know it worked

These replace "it looks done." Each is a thing a person does, timed or checked.

1. **The sign test.** Draw a 200 × 120 mm rounded-corner plaque with a 6 mm
   corner radius, four 5 mm mounting holes inset 10 mm from each corner, and a
   line of centred text — **without importing anything and without touching a
   number field in a side panel**. Every dimension typed on canvas.
2. **The bracket test.** Draw an L-bracket profile using line + arc + fillet +
   trim, offset it outward by 3 mm for a kerf-independent flange, and mirror it.
   Geometry must close cleanly enough to compile with zero open-contour warnings.
3. **The dimension-drive test.** Place a linear dimension between two edges,
   type a new value, and watch the geometry update. This is the single feature
   that separates "drawing program" from "CAD".
4. **The 2.5D test.** Assign a 6 mm pocket depth to an interior profile and a
   through-cut to the outer profile, see both correctly in the 3D view, and get
   CNC toolpaths that match what the 3D view showed.
5. **The round-trip test.** Everything drawn in the Studio survives Apply →
   save `.lf2` → reload → reopen Studio, still parametric and still editable.
6. **Perceptual verification (CLAUDE.md rule 2).** Every one of the above is
   confirmed by **rendering the result and looking at it** — a golden-image or
   perceptual-harness comparison — never by a green unit test alone. Any claim
   not visually confirmed ships labelled **not verified**.

---

## 3. Hard constraints this work must respect

Non-negotiable, from the repo's own governance. A plan that violates one of
these is wrong, not clever.

- **Rule 7 — Frame is the only guard.** A design tool must never add a refusal
  to Frame, Start, preview, export, save, or G-code emission. Design operations
  that cannot produce geometry return a `Result` error and inform (Job Review
  warnings list / a toast); they never gate a machine action. Growing a refusal
  surface requires the maintainer's prior permission and is presumed denied.
- **Pure core.** All geometry lives in `src/core/**` with no DOM, no
  `Date.now()`, no `Math.random()`, no `console`, no throwing for control flow.
  Solvers take an RNG and a clock as parameters if they need them.
- **File-size discipline.** 400 counted code lines hard per file, 600 raw, 80
  per function, complexity 12, one default export. A design tool is large; it
  will therefore be *many small files*, not a few big ones.
- **Module boundaries.** `core → core` only; `ui → core, io, platform/types`.
  The three.js dependency is UI-only (ADR-102) — no three.js in `core`.
- **Dependency policy (ADR-017).** MIT / BSD / Apache-2.0 / ISC / MPL only.
  **GPL-family is rejected** — which rules out lifting Inkscape, SolveSpace, or
  anything derived from them, and must be checked before adopting any constraint
  solver or CSG library. Every adoption needs a `RESEARCH_LOG.md` entry.
- **Bundle budget.** Web target < 1 MB compressed. The Studio must be
  lazy-loaded and must not enter the main chunk — Image Studio's precedent.
- **Determinism.** Same input + params → byte-identical G-code. Anything the
  Studio produces must flow through the existing compile path unchanged.
- **Scope governance.** `PROJECT.md` currently lists as **out of scope**:
  "Boolean ops" (though offset/boolean shipped via ADR-103/131), "a general
  geometry kernel", "node/graph-based operation editors", and "macros,
  scripting, command palette, plugins, extensions". A typed command line is
  adjacent to "command palette" and a constraint solver is adjacent to "geometry
  kernel" — **both need an explicit maintainer decision plus an ADR before
  implementation, not an assumption.**

---

## 4. Explicit non-goals

Naming these now so scope does not drift mid-build.

- **Not a B-rep/NURBS kernel.** No OpenCascade, no STEP modelling, no fillets on
  3D solids. 2.5D means *2D profile + depth*, full stop.
- **Not a 3D modeller.** No sculpting, no mesh editing, no boolean solids as a
  design primitive. The 3D view is a *view* plus placement, not a modelling mode.
- **Not an assembly/history CAD.** No feature tree, no timeline rollback, no
  parametric part relationships across objects beyond the constraint layer.
- **Not a plugin platform.** No scripting API, no user macros.
- **Not a replacement for Image Studio.** Rasters stay in Image Studio; the
  Design Studio is vector + 2.5D. The two hand off to each other.
- **Not a redesign of the main canvas.** The existing workspace keeps working
  exactly as it does; the Studio is additive and opt-in.

---

## 5. Open decisions the maintainer must make

Flagged here rather than assumed. Each is answered before the stage that needs
it, not before the whole build.

1. **Constraint solver — buy, build, or skip?** A true geometric constraint
   solver is the single largest item in this brief. The candidates' licenses
   decide it. If none is MIT-compatible, the choice is between writing a bounded
   in-house solver (real work, high value) and shipping *dimension-driven
   editing without a general solver* (much cheaper, covers most laser/CNC needs).
2. **Command line — in or out?** `PROJECT.md` lists "command palette" as out of
   scope. A typed coordinate/command entry is what makes AutoCAD feel like
   AutoCAD. Needs an explicit yes/no.
3. **Separate window or in-place mode?** Item 7 asks for "a separate pop up
   window like our photoshop." Image Studio is a full-window *overlay*, not an
   OS window. Confirm overlay parity is what is wanted (recommended) rather than
   a real second browser/Electron window.
4. **Where does 2.5D depth live?** On the Layer/operation (today's model), on
   the object (`operationOverride` precedent), or as a new first-class property.
   This one is architectural and gets its own ADR.

---

## 6. Method — how the work runs

- **Research first, with sources.** Every competitor claim comes from a fetched
  primary doc, cited by URL. No feature list from memory (CLAUDE.md §"verified
  research").
- **Plan as a document**, reviewed before code — a design + self-audit doc in
  `docs/audits/`, matching the G-code Inspector and Image Studio precedents.
- **ADR before architecture.** New unions, new stores, new dependencies, and the
  depth model each need a `DECISIONS.md` entry. Next free number is **ADR-268**
  (`node scripts/check-adr-numbers.mjs` prints it — always re-run, numbers race).
- **Staged, individually reviewable diffs** (CLAUDE.md rule 1). Every stage is
  independently shippable and CI-green: `pnpm test`, `pnpm lint`,
  `pnpm typecheck`, `pnpm format:check`.
- **Every stage ends with a Job Completion Report** (CLAUDE.md rule 8), stating
  plainly what was verified perceptually and what was not.

---

## 7. What "end to end" means here

"Build from end to end" is read as: *the vertical slice works, not every tool
exists.* Concretely, the first shippable increment must let a person open the
Studio, draw a dimensioned profile by hand, assign it a depth, see it in 3D, and
cut it — thin but complete. Breadth (every arc variant, every array mode, every
constraint) is added afterwards, stage by stage, against a surface that already
works end to end.

A tool inventory with no path to G-code is not the deliverable. Neither is a
G-code path with two tools.
