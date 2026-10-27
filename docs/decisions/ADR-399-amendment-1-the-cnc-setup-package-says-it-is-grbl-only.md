## ADR-399 Amendment 1 - The CNC setup package says it is for GRBL-family controllers (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v4 H3-P2-1 (P2), confirmed by an independent refuter.

### Context

Item 1 listed Save G-code, tile export and surfacing export. The CNC setup package (Save G-code →
"Save setup sheet + program…", `src/ui/app/CncSetupDocumentExport.tsx`) holds the same GRBL
dialect programs, in both its modes, and said nothing on a Marlin or Smoothieware profile: the
only toast was "Saved…". Save as of the same project gave the warning.

### Decision

1. **The package warns as Save as does.** When the profile's controller cannot run KerfDesk CNC
   jobs, clicking "Save setup sheet + program…" pushes item 1's warning, on each attempt, as Save
   as does.
2. **The sheet prints it.** The same warning joins the package's warnings, so the printed sheet
   that goes to the machine carries it.
3. **The other-controllers note follows a save**, as after Save as (item 5), when no controller
   confirmed the GRBL-family profile this session.
4. Bytes, modes and the save itself are unchanged.

### Consequences

- Regression test: `CncSetupDocumentExport.test.tsx` (both modes on the Smoothieware profile).
