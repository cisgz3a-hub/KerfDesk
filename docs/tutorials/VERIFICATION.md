# Visual tutorial verification

Implementation: `codex/visual-tutorials-20260919`, based on main `7d4b82812f4ee059edb6f077b8ec6870d06356e2`. Checked locally on Windows with Chrome on 19 September 2026. No merge, deployment or machine operation was performed.

## Coverage

The library contains 93 lessons. The command map covers every registered command explicitly; contextual bindings cover workspace tools, shipped Design Studio tools, Image Studio workflows, laser/CNC operations, generators, calibration, placement, libraries and machine controls.

Catalog checks validate unique IDs, metadata, command mappings, related links, static and dynamic tool bindings, and every referenced illustration at all three stages. The learning data and example renderers have no project or controller dependencies.

## Functional checks

- The full `pnpm test` run completed 2,140 suites: 2,117 passed, nine failed and 14 were skipped. It identified initial-focus regressions, old tests selecting the first button instead of the relevant action, and a macro-module dependency violation. Those were corrected without changing machine behavior or weakening the macro boundary.
- The full run also encountered two timing-sensitive suite failures and a Vitest worker RPC timeout while other work was competing for host resources.
- After fixes, a single-worker rerun of **all nine failed suites**, the tutorial suites and additional Console integration suites passed: **160 tests across 21 suites**, with no unhandled errors. The timing-sensitive suites passed without changing their limits. These results are a full diagnostic run followed by focused verification, not a new clean full-suite or release-readiness run.
- Additional focused checks covered the menu, toolbar, shared dialogs, active drawing tools and affected tool dialogs. The final accessibility checks preserve original form focus, include Tutorial in Tab navigation, restore focus after Escape and keep the enclosing editor open.
- Whole-repository ESLint passed during implementation. Final changed-file lint and formatting passed. `pnpm build:web` passed, including TypeScript checking and production bundling.
- The deferred tutorial chunk is 191.87 kB (57.17 kB gzip) and appears in the generated service-worker precache manifest.
- File-size, public-export and ADR numbering gates passed. The soft file-size report remains informational.

## Browser checks

Verified against the local app at `http://127.0.0.1:5197`:

- Toolbar Learn opens the searchable library; command-row help opens its specific lesson even when the command is disabled.
- An edited Box Generator width survives opening and closing its tutorial. Escape returns focus to the Tutorial button; reopening the tool initially focuses Material thickness as before.
- Lesson steps, restart, completion, related links, machine/category filters and empty results work. Completion survives a page reload.
- Optional playback reaches Result and stops. Reduced motion hides playback and retains all three explicit stage controls.
- Desktop (1440 × 1000), narrow (700 × 850) and phone-width (390 × 844) views remain usable. At 390 pixels, the reader's scroll width equals its client width.
- Trace, variable text, CNC, probing and calibration examples were visually inspected. No page errors were reported during these flows.

A separate production-bundle smoke test at `http://127.0.0.1:5297` opened the library, switched the test browser offline, reloaded the app and opened the first-project lesson with its illustration. `navigator.onLine` was false. The test browser was restored online afterward; no page errors were reported.

Illustrations are teaching examples. Software checks do not establish physical-output qualification or prove that every new user can complete every workflow. That requires representative user trials and the ordinary machine/material verification appropriate to the actual job.
