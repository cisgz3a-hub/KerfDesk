## ADR-049 Amendment 2 - Complete startup artwork and visible hold in both editions (2026-10-18)

**Status:** Implemented. | **Date:** 2026-10-18

### Context

The maintainer reports that the loading screen is still too fast and initially appears black,
with its timber artwork popping in afterwards. The separate image request and asynchronous
decode permit text to paint without timber. Amendment 1 measures two seconds from navigation,
so cold module loading and time before the desktop window appears consume the hold. The
maintainer confirms that the screen is too quick in both browser and desktop.

### Decision

Vite embeds the existing `public/startup-craft.webp` in the entry HTML for development, web and
desktop builds. The image requests synchronous decoding, so artwork and branding paint
together without an independent artwork request or runtime image-loading script. The original
asset remains the editable source. Existing image CSP rules already permit data URLs.
The splash stays hidden until a final inline style after its complete artwork and branding
has been parsed, so a streamed HTML response cannot reveal an empty container first. The
workspace remains inert and the splash consumes pointer and keyboard input until removal.

Both browser and desktop hold the splash for four visible seconds, starting at the first
animation frame after the workspace module installs its dismissal lifecycle, then fade over
750 ms. Hidden document intervals do not consume that hold. The fade also waits for a successful
workspace paint. In Electron, native BrowserWindow show/hide/minimize/restore events publish
actual window visibility with monotonic revisions; document visibility alone remains unsuitable
because background throttling stays off to preserve running-job wake locks. The five-second
missing-workspace fallback still starts when the workspace
module installs dismissal. A root startup error bypasses the minimum. Reduced motion removes
the fade and animated light, while retaining the hold.

### Consequences

A fast launch presents the complete timber screen for about 4.75 seconds after the
workspace module starts. A cold module graph can extend the total startup-screen duration;
time already spent loading cannot erase the visible hold. Embedding adds roughly 177 KB to
uncompressed HTML and removes a separate fetch/decode race. No machine, output, licence,
startup interaction or publication policy changes.
