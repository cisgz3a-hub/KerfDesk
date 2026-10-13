## ADR-593 - Floating machine utility tabs

**Status:** Accepted by the maintainer on 2026-10-13 after reviewing the C design.

**Amended:** [Amendment 1](ADR-593-amendment-1-inline-utility-panels.md) replaces
the floating presentation with inline panels after a reported overlap with Artwork.

**Decision.** The integrated machine rail keeps its existing jog, centre Home,
manual air, Set origin and autofocus cluster. The lower utility scroller is
replaced with Origin, Placement and Console buttons with a subtle static glow.
Each button opens one viewport-contained, nonmodal dropdown; Escape or its close
button returns focus to the opener. Outside interaction dismisses it. Forms keep
native Tab navigation, and their drafts and disclosure state survive closing or
switching tools. A closed Console holds its last transcript.

Origin contains existing origin utilities, typed/saved positioning, the timed
start mark and the hand-positioning guide, plus CNC probing. Placement contains
the existing placement/output fields and CNC maintenance utilities. Console
contains communication controls, Super console, machine hours and execution
history/recovery. No function is deleted. Live-job controls, accessory resets,
checkpoint notices, probe-plate removal and work-Z recovery remain outside the
dropdowns. A newly required probe-plate reminder dismisses the covering dropdown
after any open modal closes, preserving its focus and modal lifetime. The tools
can then reopen while the reminder remains required. The Frame/Start dock stays
in its current location.

The current machine state shares the rail heading; full coordinates, work-origin
identity and feed/power details remain in Origin. On short laptop bodies the
same three utility buttons use a single horizontal icon/label row so opening a
tool does not scroll the existing jog and powered-Z controls out of position.
Narrow short bodies show labels without the decorative icons and chevrons.

The ordinary rail no longer has an independently scrolling lower section.
Exceptional short windows and expanded live recovery notices retain the outer
rail's accessibility fallback. A long dropdown may scroll within the viewport.
This is presentation only: handlers, readiness, Frame/Start policy (ADR-565),
entitlements, controller transport and hardware behaviour are unchanged.

**Verification.** Exercise keyboard/outside dismissal, retained Console drafts,
all original jog actions, CNC utilities and notices, and narrow/short layouts.
Source and browser tests do not establish hardware qualification.
