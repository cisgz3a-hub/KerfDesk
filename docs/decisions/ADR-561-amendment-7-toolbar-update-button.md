## ADR-561 Amendment 7 - Update button in the toolbar

Date: 2026-11-10

Status: Accepted by the maintainer's request: "I would also like an update button to appear at the top when an update is available that can directly update from that button. it can glow a bit". Targets the first release after 1.0.30; it does not hold 1.0.30 back.

### Context

A desktop update was announced by a small ghost **Update available** / **Update ready** button in the status bar (ADR-547 decision 5), which only opened Help > Check for Updates, and by the canvas card of [Amendment 5](ADR-561-amendment-5-canvas-update-prompt.md), which the user can clear until the next start. Once cleared, the update was easy to miss, and updating took several clicks in a panel. The maintainer wants a prominent button at the top that updates from one click, without loosening job safety: an update must never interrupt a running job or lose work.

### Decision

1. **Placement.** While a desktop update is offered, downloading or downloaded, `src/ui/licensing/ToolbarUpdateButton.tsx` shows an **Update** button first in the toolbar's right-hand utilities group. That group is not among the commands that fold into the toolbar's More menu, and the toolbar sits above every panel in both laser and CNC workspaces. It reads the same status and drives the same actions as Help > Check for Updates through the controls `CommercialUpdates` already publishes; it adds no update route, request or native capability.
2. **One click.**
   - An offered manual update (`state` `available`): the click is the existing **Download update**. The button then shows progress in its label (`Downloading…`, `Updating 42%`, `Verifying…`) and its tooltip, and clicking it while downloading opens Help > Check for Updates.
   - On macOS and Linux (`delivery: 'download-page'`, ADR-613) the click is the existing **Open download page**: KerfDesk never downloads or installs those updates itself.
   - A verified manual download (`ready`): the click asks once in a small non-modal popover, "Install KerfDesk X.Y.Z now? KerfDesk asks you to save unsaved changes, then closes and opens the installer", with **Install now**, **Not now** and **Details…**. **Install now** is the existing guarded **Install and close KerfDesk** of [Amendment 3](ADR-561-amendment-3-install-and-close-kerfdesk.md). The popover does not promise a restart: the installer is interactive and opens after KerfDesk exits.
   - An update with no install-now action (the signed lane, which installs on a normal close, or an older native service) shows **Update ready** and opens Help > Check for Updates.
   - A failure is shown on the button (**Update failed**, opening Help > Check for Updates) only after the user acted on it.
3. **Safety.** The button never closes, restarts or installs by itself. While a job is running or paused, Fire, a motion, controller operation, MPG or observed external motion owns the window, a Frame is being prepared, or Job Review is open, the button stays visible as **Update after job**, marked unavailable, and does nothing. It is offered again when the work ends. As Amendment 3 requires, nothing installs or closes automatically after the work finishes. An open question is withdrawn when such work starts, and **Install now** rechecks the same conditions at the click. Behind that, the update close itself still refuses during machine work and runs the ordinary Save, Don't Save and Cancel question. The button is a new way to reach those guards, not a way around them. Downloading stays available during a job, because it never closes the app.
4. **Glow.** While one click downloads or installs, a flat copper ring (`--lf-accent`) around the filled button breathes between 15% and 60% opacity every 2.4 s. It uses no blur and no box-shadow, and animates only opacity, which the compositor runs without repainting the toolbar (tokens.css performance note). With `prefers-reduced-motion: reduce` the ring holds still at 35%. Downloading, waiting and failed states do not glow.
5. **Accessibility.** The button is a native button, focusable by keyboard with a copper focus ring. Its accessible name gives the label, the version and what a click does. The unavailable state uses `aria-disabled`, so focus stays on it. The install question is a labelled dialog popover that takes focus and closes on Escape. The polite live region that announced an offered or downloaded version moves from the status bar button into this component unchanged.
6. **The status bar button is removed.** `UpdateReadyButton` is deleted: two update buttons would compete. The toolbar button does everything it did, which was opening Help > Check for Updates, from the same states. This amends ADR-547 decision 5. The canvas card of Amendment 5 stays; its **Not now** now points to the toolbar.
7. **The browser build keeps its status bar Update button** (ADR-227, ADR-228). Applying a web update reloads the page, and that reload has no job guard: ADR-228 kept it a passive command. Putting it in a glowing button at the top would invite a reload that could stop a Web Serial job. Moving it there needs that guard first, as a separate decision. The unsigned Preview's **Download update** (ADR-249) also stays in the status bar.

### Consequences

- An offered update is visible at the top until it is installed, and updating takes one click plus one confirmation.
- No new native route, no change to download, verification, licence eligibility or the installer handoff.
- Existing installations gain the button only after installing a release that contains it.

### Evidence boundary

`src/ui/licensing/toolbar-update-state.test.ts` covers the state-to-button mapping, labels, titles and glow. `src/ui/licensing/ToolbarUpdateButton.test.tsx` drives the click path against the real update owner with a stubbed native service: download, progress, confirmation and install, Not now, no install while a job runs or is paused, a question withdrawn when Frame preparation starts, the click-time recheck, Job Review, the macOS and Linux page, the signed lane and failure reporting. `CommercialUpdates.test.tsx` and `UpdatePrompt.test.tsx` now use the toolbar button. No test calls the live update feed. The glow and reduced-motion styles are CSS and were not rendered in a packaged app. These checks do not qualify a packaged installer or a customer upgrade.
