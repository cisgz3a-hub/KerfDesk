# G-code viewer competitive audit — KerfDesk Inspector vs the field

**Date:** 2026-07-26 · **Scope:** what other G-code visualisers do that we don't, and what is worth taking.

## 0. How this was researched, and what that's worth

This is a **desk audit**. I read vendor documentation, feature pages and one prior source-verified research pass; I did **not** install and drive every tool, and I did not read most of their source. Where a claim comes from documentation rather than my own observation, treat it as "they say they do this", not "I watched it work".

Two sources carry more weight than the rest:

- `docs/audits/2026-07-25-cnc-3d-threejs-research-and-roadmap.md` Part 3 (in-repo, on the sibling branch) — rendering techniques read **from the actual source** of gcode-preview, CAMotics, Kiri:Moto, jscut, OpenBuilds CONTROL and ncviewer.
- Fresh documentation fetches for this audit, cited at the bottom.

The field splits into three families, and only one of them is really our competitor:

| Family | Examples | Relationship to us |
|---|---|---|
| **Slicer previews** (FDM) | PrusaSlicer / OrcaSlicer / Cura | Not competitors, but the **most mature previews in existence**. Best source of UX ideas. |
| **CNC verifiers** | CAMotics, NC Viewer, NC Corrector, mechsimulator, webgcode | Our actual peer group. |
| **Sender-embedded viewers** | UGS, CNCjs, OpenBuilds CONTROL, Candle | Closest to our *live* use case. |

---

## 1. Where we are genuinely ahead

I went looking for prior art on each of these and did not find it in the surveyed tools.

**1. Planner-true time.** Every surveyed tool estimates time as distance ÷ feed, which ignores acceleration and cornering — the two things that actually dominate on detail-heavy work. Ours runs the same GRBL-style lookahead planner the Job Review estimate uses, and measured **exactly 1.0000** agreement across three fixtures. No surveyed tool does planner-accurate time.

**2. The planner lens.** Colouring moves by *whether they ever reached the programmed feed* answers "why is my job slow" from the program itself. I found no equivalent anywhere.

**3. Total line accountability.** Every raw line classifies into exactly one category — motion, modal, event, comment, blank, marker, unsupported, junk, after-end — and it's a property test in CI. Other viewers silently skip what they don't understand. This is the difference between "the viewer drew nothing there" and "the viewer *told you* it drew nothing there, and why".

**4. Own-output-clean gate.** CI asserts our own emitters' G-code parses with zero unsupported-word notes. Nobody else has this because nobody else is both the writer and the reader.

**5. Health findings are richer.** mechsimulator has the closest thing — a linter with **4 checks** (arc I/J mismatch, G01 with F=0, cutting before M03/M04, missing coordinates) and clickable line-jump. Ours has **11 findings across three severity tiers**, and it's explicit in the UI that findings inform and never block.

**6. Live machine + program in one view.** Sender viewers show the head; verifiers show the program. We show both in the same scene, with the simulated playhead and the live machine deliberately different colours.

---

## 2. Where the field is ahead of us

Ordered by how much I think it actually matters.

### 2.1 Material removal — the one real capability gap
CAMotics's own positioning is that the difference between it and a basic viewer is **stock-removal preview**: not the tool centreline, but the workpiece shape that results. It also exports the simulated stock as **STL**. Kiri:Moto does the same by a different method.

We draw centrelines. For a laser that's nearly the whole truth; for CNC it is not — you cannot see gouges, leftover material, or whether a pocket actually cleared. Our prior research already catalogued four viable techniques (depth-buffer heightmap, CPU heightfield + tool stencil, CSG on sliced stock, SDF + marching cubes), so the path is mapped.

**This is the biggest single thing we don't have.** It is also weeks of work, not days.

### 2.2 Canned drilling cycles are a correctness gap, not a feature gap
mechsimulator renders **G81/G83 as drill markers**. Our parser doesn't implement canned cycles at all — `G81`/`G83` fall through as unsupported words, so a drilling program renders its rapids but **not its drill plunges**. The Health panel would report the unsupported word, so we're honest about it — but a shop program with drill cycles is under-drawn today. Worth fixing before material removal.

### 2.3 Legend entries as filters
PrusaSlicer's legend labels **are buttons** — click "perimeter" to hide perimeters. We have one traversal toggle and a legend that only reports counts. Making every legend swatch a filter is cheap and immediately useful.

### 2.4 Time fraction per category
PrusaSlicer shows **print time fraction per feature**. We show distance totals per move kind and one overall ETA — but not "cutting 61%, traversal 22%, plunging 4%". We already compute per-segment seconds, so this is arithmetic we've paid for and aren't spending.

### 2.5 Depth/Z isolation
PrusaSlicer has a vertical layer slider; gcode-preview does Z-range scrubbing by clipping plane *and* shader discard. We have a depth **lens** (colour) but no way to **isolate** a depth range. For multi-pass CNC this is how you inspect one pass without the others in the way.

### 2.6 Measurement
NC Corrector offers measurement between toolpaths. We have none. Our design doc lists it (L3/L4 detail ladder) but it isn't built.

### 2.7 Small ergonomics we're missing
- **Free hover readout** — mechsimulator shows coordinates under the cursor anywhere; ours only reports at the playhead.
- **Direction arrows** — mechsimulator has an optional overlay; our design doc lists it as graduating from the detail ladder, and it's still unbuilt. This is how you read climb vs conventional at a glance.
- **Drill markers** — follows from 2.2.

---

## 3. Things I deliberately do **not** recommend copying

- **Standalone viewer app.** PrusaSlicer ships `prusa-gcodeviewer` separately. We are the CAM tool; a separate binary adds packaging burden for no operator gain.
- **Machine-geometry simulation** (CAMotics simulates the machine itself). Real value is collision detection, which needs a machine model we don't have and would be a large, low-yield detour.
- **Fancy postprocessing** (AO, bloom, outlines). Our own research priced these; they cost bundle size and MSAA, and none of them help an operator read a toolpath.

---

## 4. Recommended order

| # | Item | Why it's here | Rough size |
|---|---|---|---|
| 1 | **Canned cycles (G81/G83/G80…)** | Correctness, not polish — drill moves are currently undrawn | Small–medium |
| 2 | **Legend entries as filters** | Cheap, high daily value | Small |
| 3 | **Time fraction per move kind** | Data already computed | Small |
| 4 | **Direction arrows** | The one thing that makes cut direction readable | Small |
| 5 | **Z-range isolation** | How you inspect one pass of many | Medium |
| 6 | **Hover readout + measure** | Closes the "smallest detail" ladder | Medium |
| 7 | **Material removal + STL export** | The real capability gap; do it deliberately, not squeezed in | Large |

---

## 5. Honest bottom line

You asked whether ours is already the best. My read: **for reading and verifying a program, yes — I could not find a tool that matches the combination of planner-true time, line accountability, the health report, and live-machine overlay in one view.** The individual pieces exist elsewhere; the combination doesn't, and two of the pieces (planner-true time, the planner lens) I couldn't find at all.

**For simulating the resulting workpiece, no — CAMotics and Kiri:Moto do something we simply don't do.** That's a different question than the one we set out to answer, and the design deliberately scoped it out, but it's the honest gap.

The nearest thing to a "we should have thought of that" is mundane: **PrusaSlicer's clickable legend**. It's a small change that makes the legend an instrument rather than a label, and we already have every piece needed to build it.

---

## Sources

- [PrusaSlicer G-code viewer — Prusa Knowledge Base](https://help.prusa3d.com/article/prusaslicer-g-code-viewer_193152)
- [G-Code Simulator (mechsimulator) — linter checks and features](https://mechsimulator.com/tools/cnc-gcode/)
- [CAMotics vs NC Viewer — cnccode.com](https://cnccode.com/2025/07/20/camotics-vs-nc-viewer-which-g-code-simulator-is-right-for-you/)
- [CNC visualizers list — Sienci Labs Resources](https://github.com/Sienci-Labs/Resources/blob/main/cnc-fun/software/cnc-visualizers.md)
- [webgcode (nraynaud)](https://nraynaud.github.io/webgcode/) · [NC Viewer](https://ncviewer.com/) · [CAMotics](https://camotics.org/) · [NC Corrector](http://nc-corrector.inf.ua/index_EN.htm)
- In-repo: `docs/audits/2026-07-25-cnc-3d-threejs-research-and-roadmap.md` Part 3 (source-read techniques from gcode-preview, CAMotics, Kiri:Moto, jscut, OpenBuilds CONTROL)

*Prepared by Claude (Fable) on 2026-07-26. Desk audit: documentation and one prior source-verified pass. No competitor was installed and driven for this comparison.*
