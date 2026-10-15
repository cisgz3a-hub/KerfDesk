## ADR-540 Amendment 5 — Registration Jig and Place Board are Pro tools (2026-10-15)

**Status:** Implemented in source | **Amends:** ADR-540 tool list

The maintainer requested that Registration Jig and Place Board also be Pro tools
on 2026-10-15. Both commands use the existing edition gate when opening their
panels. Free menus mark them Pro and the existing trial/licence dialog names the
chosen tool. Unlocking Pro continues the original command. Closing an already
open panel does not ask for Pro again.

This changes tool entry only. Existing jig and captured-board data remain usable;
project admission, machine controls, Preview, estimates, Frame, Start, Save G-code
and running jobs retain their existing policies. No new licence service or build
channel is introduced: each build keeps its current edition-provider behaviour.
