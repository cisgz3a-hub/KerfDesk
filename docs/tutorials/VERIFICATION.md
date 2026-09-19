# Visual tutorial verification

Implementation: `codex/visual-tutorials-20260919`, based on main `7d4b82812f4ee059edb6f077b8ec6870d06356e2`. Checked locally on Windows with Chrome on 19 September 2026. No merge, deployment or machine operation was performed.

## Picture and accuracy revision

The source audits cover the principal instructions in all 93 lessons. Eight generated material/example pictures serve nine lessons; fifteen cutter pictures cover the CNC catalog families and custom engraving tip shapes. All 46 responsive WebP files together occupy **508,300 bytes**. The diagrams remain available and teach software actions that a generic photograph cannot show accurately. See [picture decisions and prompts](generated-pictures.md) and [CNC manufacturer references](cnc-bit-picture-research.md).

Focused verification across the final affected suites passed **107 unique tests in 15 suites**: 63 tutorial tests, 13 PWA/delivery tests and 31 CNC selection/form tests. These are cumulative focused results, not a new full-repository run. The asset tests read real WebP dimensions, bytes and content hashes. Reader and chooser checks exercise deferred images, correct registration stages, failure/retry, default/inherited selections, existing draft/save behavior, the retained 3D toast and project-state isolation. A stale-progress fixture was corrected to use a valid saved step, and the repository-wide AST audit now filters irrelevant files before parsing and has an explicit filesystem-audit time allowance; its assertions are retained.

Changed-source ESLint and formatting passed, as did the file-size, export and ADR gates. `pnpm build:web` passed with TypeScript checking and 2,651 transformed modules. The deferred tutorial chunk is **206.48 kB / 61.87 kB gzip**. The build retains the pre-existing large core/workbench chunk warnings. The generated service worker has 186 precache entries and **zero tutorial picture entries**; all 46 picture files are present in the production output.

An independent source/visual review found no actionable findings in the photo renderer, corrected lesson text, new SVG scenes, image cache policy, CNC mapping or selector integrations. It inspected all eight compressed tutorial photos. Root also inspected every cutter picture and corrected the O-flute ball-nose helix before shipping the selected variant.

Production Chrome checks at `http://127.0.0.1:5297/` used a fresh browser context, the real service worker, and disabled ordinary HTTP caching:

- Startup, service-worker installation and the tutorial library made **zero `/tutorial-images/` requests**.
- Opening Registration requested one 960-pixel storyboard, **85,476 bytes**. Advancing through its four written steps used the same candidate. The runtime cache stored it with `image/webp`.
- Show diagram and Show picture worked. The reader stayed within its width at 390 × 844 (370-pixel client and scroll widths).
- The app and the visited desktop picture reopened offline. An unseen Pocket picture fell back to the diagram and readable instructions; Show picture retried successfully after returning online.
- Responsive sizes are separate cached URLs. An unvisited size can also require the diagram offline, even if a different size of the same picture was viewed earlier. The successful visited-picture check uses the same viewport/candidate.
- CNC Startup Setup initially mounted no pictures. Selecting ball nose and then downcut requested only those two small files and updated the description. The open card stayed within its width on mobile (330-pixel client and scroll widths), and the setup was cancelled without saving.
- No page JavaScript errors were observed. Expected failed requests for unseen offline pictures are distinct from page errors.

Local browser receipts and screenshots are in `C:/Users/Asus/.codex/visualizations/2026/09/19/01a0b94a-ca80-72d2-9225-51add3eb8b5b/tutorials/`, including `picture-browser-receipt.json` and the `production-*.png` captures. The browser harness was adjusted to keep the visited responsive candidate consistent and distinguish an opened chooser card from the closed catalog card for the same family; these were verification-selector corrections, not application changes.

No hardware, packaged-desktop qualification, publication or new release-readiness claim is included in this revision.

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
