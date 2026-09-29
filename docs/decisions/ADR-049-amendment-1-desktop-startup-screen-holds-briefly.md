## ADR-049 Amendment 1 - The desktop startup screen holds briefly instead of flashing (2026-09-29)

**Status:** Implemented. | **Date:** 2026-09-29

### Context

ADR-049's startup branding amendment (2026-09-19) reveals the workspace as soon as the canvas has
had a paint opportunity, "without a minimum branding hold". That suits the web app, whose start
waits on the network. The desktop app loads its bundle from disk, so its loading screen appears
for only a fraction of a second. The maintainer reported on 2026-09-29 that the startup screen
in the desktop app is "too fast".

### Decision

In the desktop app only, the loading screen stays up until at least 2 seconds after navigation
started (when the static screen first paints), then fades over 500 ms. The web app keeps the
original immediate reveal and 180 ms fade. A mounted root crash screen is still revealed at
once, the 5-second fallback for a missing canvas is unchanged, and reduced motion removes the
fade in both apps. The screen still adds no interaction, modal or simulated progress.

### Consequences

A desktop launch shows the branded screen for about two and a half seconds even when the
workspace is ready sooner. The hold lives in `src/ui/app/main.tsx` next to the existing reveal
conditions; `index.html`'s transition keeps the web duration and the desktop fade overrides it
when it starts.
