## ADR-656 Amendment 2 - The CNC setup package writes the package from the click (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v4 H3-P3-2 (P3).

### Context

The CNC setup package checked the open project again after its picker returned and, when the
project had changed, returned without writing. Chromium has already emptied the chosen file by
then, so an existing file was left at 0 bytes, the outcome Amendment 1 removed from four other
saves.

### Decision

1. As Amendment 1 decision 1, the package still checks the project at the click, before the
   picker opens; a package that is stale then opens no picker.
2. As Amendment 1 decision 2, a project change while the picker is open no longer cancels the
   write. The file gets the package the operator clicked Save for, with its exact programs and
   manifest, and the save says "Saved the setup package from before the project changed. Reopen
   Save G-code to include the change."

### Consequences

- The test that pinned the cancelled write now expects the clicked package and the note
  (`CncSetupDocumentExport.test.tsx`).
