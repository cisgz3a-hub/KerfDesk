## ADR-227 Amendment 2 - The web Update button waits for machine work

**Status:** Accepted by the maintainer's answer on 2026-11-11, "Yes, make it wait", to the question "Should the web app's Update button wait until a running job has ended?" (user annoyance audit A2, finding B1-P1-1). **Date:** 2026-11-11

Numbered 2 because ADR-227 already carries one dated amendment of 2026-07-17 in `DECISIONS.md` (the polite live region).

### Context

ADR-227 decision 2 puts a passive **Update** button in the browser build's status bar; a click applies the waiting service worker and reloads the page. Decision 3 kept it reachable in every machine state, because ADR-228 had made a completed Frame the only ordinary guard, and "Alternatives rejected" called disabling it during a job "a forbidden non-Frame guard".

A web job streams from the open tab over Web Serial. Reloading the tab ends that stream; the unload path sends only a best-effort stop (`use-unload-stop.ts`), and the unsaved-changes prompt is deliberately off during a job (`use-unsaved-changes-guard.ts`). So one click on Update during a burn stopped the job with no question. The button is present most days, because a deploy lands on nearly every merge.

The desktop toolbar button already solved this: while machine work runs it reads **Update after job** and does nothing ([ADR-561 Amendment 7](ADR-561-amendment-7-toolbar-update-button.md) decision 4). Its decision 7 named the web button's missing guard as open: "Moving it there needs that guard first, as a separate decision".

### Decision

1. **While machine work runs, the web button reads "Update after job" and does nothing.** "Machine work" is the same test the desktop button uses (`useUpdateInstallWaits`): an active, paused, finishing or errored job, a motion or controller operation, Fire, MPG, unowned controller motion, a Frame being prepared, or an open Job Review.
2. **The click checks again at that moment** (`updateInstallWaitsNow`), so work that started after the last render still wins. A click while waiting shows one warning toast, keyed so repeated clicks do not stack: "Machine work is running, and updating reloads KerfDesk, which would stop it. Use Update again when the machine is idle."
3. **The button stays visible and focusable**, marked `aria-disabled`, with the reason in its title and an accessible name of "Apply app update after the job". When the work ends it is offered again. Nothing reloads by itself; ADR-060's "never auto-reload" stands.
4. **The live region still announces readiness** whatever the machine is doing (ADR-227's 2026-07-17 amendment).
5. **This gates the update, never Start.** Frame remains the only ordinary Start guard (ADR-228, ADR-565). Decision 3 of ADR-227 and its rejected alternative are amended for the browser Update button only.

### Consequences

- A web user can no longer stop a burn by applying an update. Updating waits until the machine is idle, as it already did on the desktop.
- A safety notice on its own, with nothing running, does not hold the update back.
- The website's download page and WORKFLOW say so.
- Not run in a browser in this change: tests cover the button with a store double, at render time and at click time.

### Evidence

- `src/ui/common/PwaUpdateButton.tsx` and its test.
- `src/ui/licensing/update-install-waits.ts`, shared with the desktop toolbar button.
- Audit: `docs/audits/2026-11-11-annoyance-a2/LEDGER.md`, B1-P1-1.
