# Visual tutorials

KerfDesk teaches features through an on-demand Learn library and contextual Tutorial buttons. The library is reachable from the toolbar and Help menu. A tool's button opens its relevant lesson, including when a menu command is unavailable because no artwork is selected. Lessons never invoke that command.

The library has one search field and a short list of topics. Expand a topic to see its lessons, or search across all tools and both machine types. The first-project lesson is available directly. Search and the open topic are kept when returning from a lesson.

The reader shows one written step, one matching picture and a short expected result. Back and Next stay visible below the reading area; Done returns to the project. Extra location, prerequisite and tip information sits in a closed More help disclosure. There are no separate picture controls, playback, step-button lists, related-lesson buttons or completion scores. Unfinished lessons resume where the reader left off; completed lessons reopen at the beginning. Progress is stored only on the current device when browser storage is available.

The left and right arrow keys also step through a lesson. Escape backs out one level, from the lesson to the library and then to the workspace. Close and Done return directly to the workspace. All tutorials returns to the library with the same search and open topic.

## Design rationale

Use help at the moment someone needs it. Avoid compulsory first-run walkthroughs. Keep entry points visible and lessons easy to close and reopen. The working project and any open tool draft remain in place underneath the learning surface.

This follows the contextual-help guidance in [Nielsen Norman Group's onboarding research](https://www.nngroup.com/articles/onboarding-tutorials/). [Adobe's Discover panel](https://helpx.adobe.com/uk/photoshop/desktop/get-started/learn-the-basics/access-discover-panel.html) provides a relevant example of combining contextual help and searchable learning. [Autodesk's Fusion learning collection](https://www.autodesk.com/learn/ondemand/collection/self-paced-learning-for-fusion) illustrates organising lessons around practical workflows. Sources reviewed 19 September 2026.

Generated pictures illustrate physical results and cutter shapes. Eight material/example images serve nine lessons, including the leather-keychain registration sequence. Fifteen cutter-family pictures accompany the CNC bit choices. These are generic learning examples; selected tool dimensions and the real controls remain authoritative. Precise SVG diagrams teach software actions and appear automatically if a lesson picture cannot load. The picture follows the current instruction without separate stage selection. Neither pictures nor diagrams are simulations of a connected machine.

Pictures are separate responsive WebP files. The initial page and tutorial library request none; only an open lesson or bit picture mounts an image. They are excluded from service-worker precaching and cached on demand. The numbered instructions identify the real controls. There are no tutorial videos to stream, external learning accounts, telemetry, or new dependencies. See the [picture research and asset notes](generated-pictures.md), [delivery audit](image-delivery-audit.md), and source audits for [design](accuracy-audit-design.md) and [machine/production](accuracy-audit-machine.md) lessons.

## Maintaining coverage

- Add a source-verified lesson to the relevant `src/ui/tutorials/*-tutorials.ts` module and export it through the catalog. Use actual button labels, gestures, settings ownership, and availability conditions.
- Choose an existing illustration that correctly teaches the operation, or add a dedicated scene. Never substitute a misleading image just to fill the space.
- Keep beginner instructions short and use one main route. Prefer actual control names and everyday words. Put optional shortcuts and extra settings in the tip. Check that the step's fixed illustration still matches whenever the wording changes.
- Add `tutorialId` to a shared Dialog, RailSection or RailPanelHeading, or place a TutorialButton directly in a custom header. Keep buttons outside disclosure summaries and other buttons.
- Add command mappings to `command-tutorials.ts`. Its exhaustive `CommandId` record makes a new command choose a lesson deliberately. Studio/tool/process mappings are explicit in their owning components.
- Use stable IDs. Search indexes titles, descriptions, actual instructions, locations and aliases. Keep related IDs resolvable.
- The catalog tests verify reference integrity, contextual entry points and illustration rendering. Interaction tests cover project isolation, dialog nesting, progress storage and navigation.
- Write UI paths as `Surface → Control`, using the label the application actually shows. `tutorial-fidelity.test.ts` reads the real menu labels and shortcut table, so a lesson that invents a menu, mixes separators, points **Learn next** at itself, or drifts from the shortcut dialog fails there rather than passing a length check.
- A lesson generator must take its step titles and outcomes per lesson. Sixteen Studio lessons once shared one set of three, and read as a filled-in form; the fidelity test caps any shared step title or outcome at four lessons.

Tutorial UI state is separate from project state and undo. The reader is lazy-loaded. Its portal is the topmost modal after editor dialogs, with focus restoration and shortcut isolation. The existing live-machine bar remains above the learning surface.

## Content boundaries

Teach only shipped tools. Unavailable Focus Test explains its status; planned Design Studio tools are not advertised as usable. CNC cutting values belong to Artwork / Operations; machine, stock, material and tool-plan choices belong to Startup Setup. A completed Frame for the exact current job remains the ordinary Start policy gate. Start opens Job Review; review findings remain warnings. Reading a lesson never frames, starts, jogs, probes, connects, exports, changes controller settings or edits the project.

Software checks and diagrams do not establish hardware, material or packaged-desktop qualification. Representative users should still evaluate whether the lessons help them complete real tasks; that usability validation is distinct from functional verification.

See [verification notes](VERIFICATION.md) for the checks and their limits.
