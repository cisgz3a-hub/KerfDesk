## ADR-561 Amendment 5 - Update prompt on the canvas

Date: 2026-10-10

Status: Accepted by the maintainer's request for a pop-up on the canvas that updates the app directly, instead of finding the update under Help.

### Decision

The in-app notification of decision 2 becomes a non-modal card over the top centre of the canvas, `src/ui/licensing/UpdatePrompt.tsx`. It reads the same status as the status bar and drives the same actions as Help > Check for Updates, through controls published by `CommercialUpdates`; it adds no update route, request or native capability.

1. A manual update that is offered shows **Update available** with the version and up to three verified improvement notes. **Update** requests the existing download. **Not now** clears that stage for the version until KerfDesk next starts, which keeps "once per available version per session".
2. After **Update** the card follows the download. A verified download shows **Install now**, the existing explicit install-and-close action of Amendment 3, **When I close**, which arms installation on a normal close, and **Not now**. Download consent and installation consent remain separate clicks. An automatically downloaded signed update shows that it installs when KerfDesk closes.
3. The card does not appear while a job, Fire, owned motion or controller work, MPG, observed external motion, a modal dialog or the updates panel owns the window, and returns afterwards. It never takes focus, never closes the app by itself and never gates Frame, Start, output or a running job.
4. A failure is shown in the card only after the user acted in it, with **Details** opening Help > Check for Updates.

This amends ADR-547 decision 5 only by adding the card; the status bar button and Help > Check for Updates are unchanged. The browser app and the unsigned Preview keep their status bar controls (ADR-227, ADR-249).

### Evidence boundary

`src/ui/licensing/UpdatePrompt.test.tsx` covers offer, clearing, download, install consent, waiting for machine work and the panel, and failure reporting against the real update owner. It does not qualify a packaged Windows installer or a customer upgrade. Existing installations gain the card only after installing a release containing it.
