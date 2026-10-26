## ADR-093 Amendment 1 - Starter Presets never replaces a saved library (2026-10-22)

**Status:** Accepted on 2026-10-22 |
**Amends:** ADR-093 decision 1 (auto-saved libraries), for the Starter Presets button

### Context

Rolling audit v2, report 21, finding P1-1. With no library open, the Material Library panel offers
**Starter Presets** on a machine with a starter catalogue (the Neotronics 4040 profile). The
button built the starter library with a fixed id, `laserforge-<profile>-starter`, and opened it
as the active library. Libraries save themselves with no Save button and no undo, so the next
save wrote the stock presets over a saved starter library of the same id. An operator who had
tuned the starter presets and added their own, then deleted the open library (or restarted with
none open) and pressed Starter Presets again, lost their presets from the app and from
`localStorage`, with no prompt. Every other way of adding a library already refused to replace a
saved one: New library takes a free id, and Import "adds a document; it never replaces a saved
library" (`material-library-import.ts`).

### Decision

1. Starter Presets adds its library the way Import does (`importMaterialLibrary`). With no starter
   library saved, it opens under the fixed id as before. With one saved that still holds exactly
   the stock presets, that one reopens and no copy is made. With one saved that differs (presets
   changed or added, or an older catalogue), that library is kept unchanged and a fresh copy of the
   starter library opens under a free id (`laserforge-<profile>-starter-2`, and so on).
2. When a fresh copy opens beside a saved one, a toast says so: "Opened a fresh copy of <name>.
   The copy you already had differs from it, so it is kept in Saved Libraries."

### Consequences

- Pressing Starter Presets can no longer delete presets. The operator's own starter library stays
  in Saved Libraries, where Open brings it back.
- Both libraries carry the starter library's name until one is renamed; Saved Libraries shows each
  one's preset count and last change.

### Tests

`MaterialLibraryPanel.test.tsx` (a changed, saved starter library survives Starter Presets and the
persistence fold, a fresh copy opens beside it with the toast; a saved stock starter library
reopens without a copy).
