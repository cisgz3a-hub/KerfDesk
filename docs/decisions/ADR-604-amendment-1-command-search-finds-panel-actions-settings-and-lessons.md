## ADR-604 Amendment 1 - Command search finds panel actions, Settings and lessons (2026-11-05)

**Status:** Accepted on 2026-11-05: the maintainer chose "widen command search (Ctrl+K)" for
the UX audit U5–U8 P3 sweep |
**Amends:** ADR-604 Decision ("every registered command", "One source", "Matching") and its
Consequences sentence "Tutorials, settings and objects in the drawing are not searched in this
first version"

### Context

The new-user audit (`docs/audits/2026-11-03-ux-u1/U6-help-discoverability.md`, U6-P2-1, rated
P3 by its refuter) found that Ctrl+K could not find what a beginner types first: Frame job, Set
origin here, Start, the jog pad, Machine Setup, Materials, Keyboard Shortcuts and Units. Its own
placeholder suggested "frame", which found Wireframe View. The refuter showed that ADR-604
scoped this out, so finding them is an extension of the ADR, not a bug fix. It also showed that
"frame job" with artwork selected put **Move Laser to Selection Center** first, a head move.
U6-P3-1 found that Learn's search was an unranked substring filter, and U6-P3-2 that Keyboard
Shortcuts was in no menu.

### Decision

1. **More entries.** Besides the registry's commands, the window lists:
   - the machine panel's named actions: **Frame job**, **Start job**, **Set origin here**,
     **Jog the head**, and **Machine Setup...** and **Materials** (**Recipes** on a CNC);
   - the Settings a beginner looks for by name, under the Settings window's own headings
     (**Units (millimetres or inches)**, **Theme**, **Workspace layout**, **Recent projects**,
     **Autosave**, **Snapping and grid**, **Canvas markers**, **Nudge distance**,
     **Machine & materials**, **Labs** on a laser, **Phone & MCP** in the desktop app);
   - up to five Learn lessons for the project's machine kind, ranked by Learn's own search.

   Menu commands still come from `buildAppCommands`, after the machine-kind and edition gates,
   so the "One source" guarantees hold for every command result.
2. **Panel entries reveal, they never press.** A panel entry opens the machine panel at its
   control (`data-search-target`) and moves focus to it. Search never runs Frame, Start, a jog or
   Set origin itself, so a search result cannot move the machine. A disabled control stays
   disabled, and a notice repeats its own hover reason, such as "Connect to the machine first".
3. **Ranking.** Each result shows its tag: its menu, **Machine panel**, **Artwork panel**,
   **Settings** or **Learn**. A typed word that is a whole label word ranks above one that only
   starts a label word, and above one found in the description. An exact label phrase still
   ranks highest. "frame job" therefore puts **Frame job** first, above
   **Move Laser to Selection Center**, which a test holds.
4. **Learn ranks too.** Every typed word must start a word in the lesson. A title word outranks
   a keyword, then the summary or location, then the step text, and a lesson made for this
   machine kind wins a tie. Lessons for the other machine kind come after the rest in Learn and
   are left out of Ctrl+K.
5. **Keyboard Shortcuts** is a registered Help command (**Help → Keyboard Shortcuts...**), so the
   menus and Ctrl+K both open it. The toolbar icon's hover names it instead of listing every key.
   The table lists F12.
6. The placeholder reads "Type what you want to do, such as frame, box or units", and every
   example finds its own result first.

### Consequences

Objects in the drawing are still not searched. No job output, Frame permission, controller
behaviour or licence gate changes. A new panel control becomes searchable once it has a
`data-search-target` and an entry in `search-entries.ts`.

### Verification

`src/ui/commands/search-entries.test.tsx` covers:

- that "frame", "frame job", "set origin", "setorigin", "start", "jog", "machine setup",
  "materials", "shortcuts", "keyboard shortcuts", "units", "inches" and "theme" each put their
  result first;
- that "frame job" with a selection puts Frame job above the head move;
- that Wireframe View falls below Frame job;
- that lessons are limited to five and follow this machine kind;
- that Labs is left out on a CNC;
- that a reveal focuses without clicking, and repeats a disabled control's reason;
- Learn's ranking, the Pro marks and the F12 row.

`command-search.test.ts` keeps ADR-604's own ranking cases, and the application-menu audit covers
**Help → Keyboard Shortcuts...**.
