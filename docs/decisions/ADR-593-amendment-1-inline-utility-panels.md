## ADR-593 Amendment 1 - Keep machine utilities inside their panel

**Status:** Accepted by the maintainer on 2026-10-13 after reporting that Origin
covered Artwork settings, selecting Dropdown tabs, and requesting implementation.

**Decision.** Origin, Placement and Console expand below their shared glowing
button row, in the normal layout of the Machine panel. They do not open above
the buttons, over Artwork, or over the canvas. One section opens at a time;
clicking its button again, its close button or Escape collapses it. Interaction
with neighbouring controls leaves the section open. These are labelled regions,
not floating dialogs. Drafts, filters and native disclosure state stay mounted.

The existing Jog, Home, manual Air, Set origin and Autofocus controls retain
their positions above the utilities. Frame/Start stays in its separate dock.
The open section uses the space remaining below its buttons and scrolls only
when its contents exceed that space. When the fixed controls and an open utility
cannot fit, short machine bodies (up to 440 CSS pixels tall) use one full rail
scroller so the utility has a readable height and every jog action remains
reachable. Expanded live recovery notices retain the outer fallback too.

Modal dialogs opened from a utility keep their own focus and lifetime. A newly
required probe-removal reminder can collapse the utility after its open modal
closes. This changes presentation only; command handlers, controller state,
Frame/Start policy, licensing and hardware behaviour remain unchanged.

**Verification.** Check actual panel containment below the buttons, no overlap
with Artwork, jog or the job dock, both themes and narrow/short windows. Exercise
keyboard dismissal, outside interaction, retained drafts, and nested dialogs.
