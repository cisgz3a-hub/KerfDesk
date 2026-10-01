## ADR-540 Amendment 1 - Browser Free builds and preserved Pro projects (2026-09-30)

**Status:** Implemented locally; deployment remains separate. **Amends:** ADR-540
items 3, 6 and 7, and ADR-544's deferred Free-build switch.

The owner asked for licensed desktop Pro and a browser Free edition with no Pro
features, and then authorised carrying out the audit's software work. This brings
forward the Free split instead of waiting for checkout to open. It does not open
sales, change the approved prices, or assert that a signed installer is available.

1. Normal browser development and production builds run Free. A browser build
   ignores desktop licence adapters and unrestricted provider overrides. Desktop
   builds without commercial metadata also run Free. The commercial desktop
   retains its signed trial, paid and developer licence flow.
2. `scripts/browser-free-build.ts` removes the registered Pro entry implementations
   before bundling, in both renderer and worker graphs. Pro UI hosts have no
   implementation imports. V-carve, relief machining, adaptive pocketing, box
   generation and advanced trace entry points cannot execute in a Free bundle.
   Camera alignment controls and saved calibration consumers are absent. Shared
   geometry and image primitives required by Free tools remain available.
   Renaming a registered function without updating the boundary fails the build.
3. `build:bundle` is browser Free. `build:bundle:desktop` and
   `build:renderer:desktop` explicitly build the complete desktop renderer. Every
   desktop packaging workflow uses that mode. The existing Playwright development
   suite runs a deliberately unrestricted **desktop-mode development harness** for
   complete renderer regressions. The production-bundle suite checks the actual
   browser Free artefact. That development override is not in a shipped build.
4. Browser project admission detects V-carve, adaptive pocket, relief operations
   and relief objects before replacing the current document. It preserves the
   incoming project separately, explains which tools need desktop, and offers a
   portable `.lf2` copy. An unsupported autosave is retained; it is never silently
   cleared, stripped or overwritten with an empty workspace. Ordinary vector
   artwork made by a Pro tool remains ordinary editable artwork.
   Rejected Pro autosaves detach the active window's autosave session before Free
   continuation. Later edits, unload writes and unrelated file-save cleanup cannot
   overwrite that source slot. Legacy recovery is cleared only by its explicit
   restore/discard flow, not by saving an unrelated document.
5. This admission rule amends item 3 for the **browser**. Existing Pro projects
   still load, edit and output in desktop Free. Neither edition adds a licence
   check to Preview, Frame, Start, Save G-code or a running job. A policy refusal
   to admit a project is explicit and is not relabelled as a compiler failure.
6. Creating or copying Pro work asks for Pro even through operation sharing,
   settings paste, recipes, duplication and arrays. Editing existing desktop
   work remains permitted. A deferred licence prompt may only apply its intended
   edit to the same project and document epoch that requested it.
7. Browser Free offers a first-visit welcome with a Windows download and an
   equally accessible **Continue with Free** choice. Closing or pressing Escape
   continues in Free, and the browser remembers the choice when storage permits.
   The Free/Pro status button can reopen it. It waits for other dialogs and machine
   activity, and yields immediately if activity starts. Download availability is
   resolved from the existing signed commercial catalogue and the website's own
   trust pins; a user click starts the versioned installer download. Missing or
   unverifiable releases leave Free available and never substitute a Preview or
   local sandbox installer. This welcome does not activate a trial or open sales.

These boundaries are a product/build separation, not a claim of unbreakable DRM.
Previously downloaded builds and historical source cannot be withdrawn by this
change. Deployment, paid checkout, signed Windows packaging and a two-version
update test remain distinct release evidence.
