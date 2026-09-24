## ADR-354 Amendment 1 - The desktop app does not ask the operator to keep KerfDesk visible (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends decision 4 of ADR-354. Changes no transport, handover or streaming behaviour.

### Context

Decision 4 warns when a requested worker transport cannot be used: the connection falls back to
the selected window port and the operator is told to keep KerfDesk visible while sending the job.
That advice is right in a browser, which throttles a hidden tab or minimised window. It is wrong in
the desktop app, whose window runs with `backgroundThrottling` off (ADR-362 decision 9): a
minimised desktop window stays visible to the page, so the window transport keeps sending. The
Machine Setup hint for the preference gave the same advice.

On the desktop the worker path normally works. A no-hardware probe on 2026-09-24 in Electron
42.11.5 showed that a dedicated worker exposes Web Serial. The production worker answered
`native-ready` for the one attached USB device and `native-unavailable` for an identity that
matched nothing. The fallback still happens on either host when the selected port cannot be
identified uniquely, so the notice has to be right on both.

### Decision

1. Every host records the fallback in the Laser log.
2. Only a host whose hidden window pauses sending, which is every host except the desktop app,
   also shows the warning toast.
3. In the desktop app the Machine Setup hint drops "If unavailable, keep KerfDesk visible during
   transfer."
4. All three texts come from `src/ui/state/laser-background-streaming-notice.ts`, keyed on the
   injected platform adapter's `id`. The app stamps that id for UI chrome only, the same signal
   that hides the desktop download link (ADR-024). No transport code reads it.

### Consequences

- Desktop operators are no longer told to keep a window visible when minimising is safe.
- The fallback stays diagnosable after the toast is gone, on both hosts.
- The window transport still shares the renderer's main thread. A busy KerfDesk window can still
  delay sending after a fallback, as it could before ADR-354; the browser warning never covered
  that either.
- Browser toast and hint text are unchanged.

### Verification

- `src/ui/state/laser-background-streaming-notice.test.ts` connects through the real connect path
  with a fake port that reports the fallback. A browser host gets the warning and the log line.
  The desktop host gets only the log line. A connection without the fallback gets neither.
- `src/ui/laser/device-setup/DeviceSetupControls.audit.test.tsx` renders the Machine Setup
  checkbox under each host. The browser hint includes the visibility sentence; the desktop hint
  omits it.
- Three of those four tests fail on the ADR-354 code; the fourth, without a fallback, passes on
  both.
- Not verified: a packaged desktop build, or a real two-adapter fallback. That a minimised desktop
  window keeps sending rests on ADR-362 decision 9 and Electron's documented
  `backgroundThrottling` behaviour.
