# Visual tutorials

KerfDesk teaches features through an on-demand Learn library and contextual Tutorial buttons. The library is reachable from the toolbar and Help menu. A tool's button opens its relevant lesson, including when a menu command is unavailable because no artwork is selected. Lessons never invoke that command.

Each lesson includes its purpose, location, prerequisites, three or more actionable steps, an illustrated example, expected results, a practical tip and related lessons. Example playback is optional; Before, Action and Result can also be selected directly. Reduced-motion users receive static controls. Completion and the last visited step are saved on the current device when browser storage is available.

## Design rationale

Use help at the moment someone needs it. Avoid compulsory first-run walkthroughs. Keep entry points visible and lessons easy to close and reopen. The working project and any open tool draft remain in place underneath the learning surface.

This follows the contextual-help guidance in [Nielsen Norman Group's onboarding research](https://www.nngroup.com/articles/onboarding-tutorials/). [Adobe's Discover panel](https://helpx.adobe.com/uk/photoshop/desktop/get-started/learn-the-basics/access-discover-panel.html) provides a relevant example of combining contextual help and searchable learning. [Autodesk's Fusion learning collection](https://www.autodesk.com/learn/ondemand/collection/self-paced-learning-for-fusion) illustrates organising lessons around practical workflows. Sources reviewed 19 September 2026.

For this version, bundled SVG illustrations provide small, offline-compatible, readable examples. They are schematic examples, not screen recordings or simulations of a connected machine. Their Before/Action/Result stages explain the concept; the numbered instructions identify the real controls. There are no tutorial videos to stream, external learning accounts, telemetry, or new dependencies.

## Maintaining coverage

- Add a source-verified lesson to the relevant `src/ui/tutorials/*-tutorials.ts` module and export it through the catalog. Use actual button labels, gestures, settings ownership, and availability conditions.
- Choose an existing illustration that correctly teaches the operation, or add a dedicated scene. Never substitute a misleading image just to fill the space.
- Add `tutorialId` to a shared Dialog, RailSection or RailPanelHeading, or place a TutorialButton directly in a custom header. Keep buttons outside disclosure summaries and other buttons.
- Add command mappings to `command-tutorials.ts`. Its exhaustive `CommandId` record makes a new command choose a lesson deliberately. Studio/tool/process mappings are explicit in their owning components.
- Use stable IDs. Search indexes titles, descriptions, actual instructions, locations and aliases. Keep related IDs resolvable.
- The catalog tests verify reference integrity, contextual entry points and illustration rendering. Interaction tests cover project isolation, dialog nesting, progress storage and navigation.

Tutorial UI state is separate from project state and undo. The reader is lazy-loaded. Its portal is the topmost modal after editor dialogs, with focus restoration and shortcut isolation. The existing live-machine bar remains above the learning surface.

## Content boundaries

Teach only shipped tools. Unavailable Focus Test explains its status; planned Design Studio tools are not advertised as usable. CNC cutting values belong to Artwork / Operations; machine, stock, material and tool-plan choices belong to Startup Setup. A completed Frame for the exact current job remains the ordinary Start policy gate. Start opens Job Review; review findings remain warnings. Reading or replaying a lesson never frames, starts, jogs, probes, connects, exports, changes controller settings or edits the project.

Software checks and diagrams do not establish hardware, material or packaged-desktop qualification. Representative users should still evaluate whether the lessons help them complete real tasks; that usability validation is distinct from functional verification.

See [verification notes](VERIFICATION.md) for the checks and their limits.
