## ADR-686 Amendment 3 - An unchanged Re-import of a knocked-out logo keeps its operations, and the choice to burn white survives it (2026-11-08)

**Status:** Accepted. Amends ADR-686 Decisions 1 and 3; restores ADR-358 Decision 6 for knocked-out
imports. Fixes rolling audit v10 V7-P2-2 (P2,
`docs/audits/2026-11-07-rolling-v10/V7-fix-design-burn-safety.md`, confirmed by its refuter).
Tested through the store's Re-import, including after Save and Open; not burn-tested. |
**Date:** 2026-11-08

### Context

ADR-358 Decision 6: "Unambiguous unchanged source content retains component identities and
path-specific operation settings". Re-import matches each re-parsed component to the scene's by a
content key of its paths (`svg-fragment-reimport.ts`). The knock-out rewrote the scene's component
(white path removed, the dark path replaced by its even-odd difference), so it never matched its own
unchanged source. It fell to `createArtworkOperations` with starter values, and the old operation
was pruned. The audit's logo went from 77 % / 3 passes to 30 % / 1 pass; the same logo with a
green diamond kept its settings. The toast, "new layer settings (1 new, 1 removed)", was a success
toast.

### Decision

1. **Match as the knock-out would rewrite the source.** `matchSvgSources` first matches each
   incoming component as parsed (a 1.0.29 import, or one whose white the operator kept). Failing
   that, it runs the import's own knock-out on the incoming fragment and matches the result, with
   the same uniqueness rules. The knock-out is deterministic, so an unchanged file gives the same
   geometry. The content key fills a missing `curves` from the polylines, as Save writes them, so the
   match holds after Save and Open.
2. **Paths map through the knock-out.** A matched component inherits each path's operations through
   the knock-out's own path map (`keptPaths`). A white path the earlier import left out gets a fresh
   operation of its own, as a fresh import gives it, so the knock-out that then runs (Decision 1)
   removes it and its operation, and the first Undo puts the white back on its own operation while
   the dark shapes keep their tuned settings (Decision 3).
3. **The choice to burn white survives.** The as-parsed copy the import pushes to history marks its
   paper whites `whiteInk: 'kept'` (also used by Amendment 2). An unchanged Re-import of a component
   whose white was kept carries the mark, so the white still burns and nothing is knocked out.
4. **Honest counts and styling.** Parts the knock-out removes after a Re-import are taken out of
   "new" (or moved from "kept" to "removed"). A Re-import that adds a part, which starts from default
   settings, is a warning toast: "Re-imported logo.svg — new layer settings (1 new, 1 removed). New
   parts start from default settings: check them before you burn." Only a Re-import where every part
   kept its settings is a success.

### Consequences

- The audit's repro keeps 77 % / 3 passes, the same operation and object ids, and the same burn.
  Design Studio commits through the same `reimportSvgFragment`, so it inherits the fix.
- A changed file still gets new operations for what changed, as ADR-358 decides, now with a warning.
- **Tests:** `src/ui/state/svg-white-fill-knockout-v10.integration.test.ts` ("V7-P2-2"): the white
  logo and the audit's green control both keep 77 % / 3 passes, ids and burn; one Undo returns the
  white on its own operation with the badge still tuned; the match holds after Save and Open; a kept
  white survives an unchanged Re-import. `src/ui/app/import-toasts.test.ts` and
  `svg-import-action.test.ts` cover the toast variants.
