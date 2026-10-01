## ADR-500 Amendment 1 — Restore machine preferences and start each canvas fresh (2026-10-01)

**Status:** Accepted. | **Date:** 2026-10-01

### Context

The operator requested that their machine and preferences survive closing KerfDesk, while a new
canvas must not inherit power, speed or other job settings from the previous canvas. They clarified
that defaults should follow the selected machine's instructions. This supersedes ADR-500's opt-in
machine restoration and automatic reuse of saved laser layer settings across canvases.

The device catalogue describes hardware: bed dimensions, power scale, capabilities, controller
commands, motion limits and supported heads. It does not provide a universal cutting recipe for
each machine. Power and speed depend on the material and operation. Existing profile/head and CNC
parameter seeding remains in use; no numerical defaults or material recipes are invented here.

### Decision

1. Restore the last committed, validated machine profile and selected Laser/CNC mode synchronously
   when creating the initial empty project. Retain the existing `kerfdesk.last-machine.v1` profile
   record, adding an optional app-only mode field. Older CNC-only records infer CNC; other older
   records retain the historical Laser fallback. Missing, invalid or inaccessible storage uses the
   generic starter. Restoration creates no undo step and does not mark the new project dirty.
2. Remember committed machine edits and mode selection. Opening or recovering a project uses that
   document's machine and settings without silently replacing the independently saved application
   machine preference. Restoration does not connect, home, probe or send a controller command.
   The separately chosen automatic-connection preference remains governed by ADR-420.
3. New retains the currently selected machine and application libraries/preferences, and creates
   fresh artwork, operations and job setup. Machine parameters remain machine-owned; stock, current
   job material bindings, operation power/speed and other job choices remain document-owned.
   Saved/opened projects and autosave recovery retain their actual operation and job values.
4. Saved laser defaults remain available for explicit reuse, by artwork colour or for all colours.
   **Make Default** also applies them to further operations in the current canvas. New, Open and
   restart end this automatic reuse; **Reset to Default** can still explicitly apply a saved preset.
   The current-canvas reuse flag is never persisted. No material library or custom preset is erased.
5. With no explicitly selected material recipe or preset, new operations use the unchanged app
   starter values, plus existing machine/profile/head seeding. UI copy identifies these as starter
   values and asks the operator to choose power/speed from their material recipe or machine
   instructions. A hardware maximum is not presented as a recommended cutting feed or power.

### Consequences and verification

- Returning operators see their saved machine immediately. The advisory starter banner remains
  useful when there is no usable saved machine or a document explicitly uses the generic starter.
- Existing application appearance/preferences and reusable libraries keep their separate storage.
  New does not clear them. Project files and autosaves remain the source of saved job settings.
- Focused store and mounted-hook regressions cover restart, Laser/CNC mode, committed machine
  changes, New, ordinary job edits, both saved-default scopes, explicit preset reuse, and project
  open/recovery boundaries. Existing autosave and project round-trip checks remain applicable.
- These checks qualify application persistence and document state, not a physical machine or a
  material recipe. Actual feeds/power must be selected for the machine, tool and material in use.
