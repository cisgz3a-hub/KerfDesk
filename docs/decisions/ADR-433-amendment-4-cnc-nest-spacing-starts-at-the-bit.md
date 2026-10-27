## ADR-433 Amendment 4 - A CNC nest starts one bit plus a margin apart (2026-10-26)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-10-26

Extends ADR-433 (after Amendment 3, which checks whole shapes and cross-operation cuts) to Quick Nest and Quantity production on a CNC project. The nest still accepts any
spacing the operator types, and Job Review's narrow-gap warnings are unchanged; nothing blocks
Frame or Start (ADR-228).

### Context

Quick Nest's Part spacing started at 2 mm in every machine mode (`QuickNestDialog.tsx`), and
Quantity production's at 2 mm too. A CNC profile that cuts on or outside a part's outline sweeps
the bit up to one diameter past it, so parts packed closer than the bit cut into each other: a
1/8" (3.175 mm) bit at 2 mm spacing cuts 1.175 mm into the next part. ADR-433's Job Review check
warns only after the nest is placed. The second CNC audit filed this as P2-review-3; later rounds
re-filed it as KNOWN (M1-P2-2, M6, F3) and none fixed it. Meta audit v1 M7-P2-5 confirmed it open
on main (`adf300522`).

### Decision

1. **The CNC spacing is the widest outline bit plus 1 mm.** `cncNestSpacing`
   (`src/core/cnc/cnc-nest-spacing.ts`) takes the widest bit (`layerCncTool`) among output layers
   whose cut is an Outside or On-path profile, the cuts whose bit runs outside the drawn outline.
   It adds a 1 mm margin and rounds up to the 0.1 mm the dialogs step by: 4.2 mm for a 1/8" bit,
   7.4 mm for 1/4". Pockets, engravings, V-carves and Inside profiles stay inside the parts and do
   not count. A laser project, or a CNC project with no such profile, has none.
2. **Quick Nest starts there.** On a CNC project its Part spacing opens at that value, never below
   the 2 mm laser default. Typing a smaller value is allowed. The dialog then says the spacing is
   closer than the bit plus 1 mm, that the bit cutting one part out can cut into the next, and the
   value to use.
3. **Quantity production starts there too.** Its Part spacing opens at the same value on a CNC
   project.

### Verification

- `src/core/cnc/cnc-nest-spacing.test.ts`: a 1/8" Outside profile gives 4.2 mm; with a 1/4" On-path
  layer the widest bit wins (7.4 mm); pockets and Inside profiles, a layer that does not output and
  a laser project give none.
- `src/ui/commands/QuickNestDialog.test.tsx`: a CNC spacing opens the field at 4.2 mm without a
  warning; at 2 mm the dialog names the 3.175 mm bit and 4.2 mm, and still submits the 2 mm the
  operator chose.
