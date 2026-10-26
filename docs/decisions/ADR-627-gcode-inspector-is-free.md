## ADR-627 - The G-code Inspector is free

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("a free G-code Inspector"). Amends ADR-540 and its Amendment 1.

## Context

ADR-540 split KerfDesk into Free and Pro and listed the G-code Inspector as a Pro tool: opening a `.nc` / `.gcode` / `.tap` file, **Inspect G-code (3D)**, and the canvas switch to the G-code 3D view each asked for a trial or licence. ADR-540 Amendment 1 then removed the Inspector's implementation (`InspectorView`, `CanvasGcodeView`) from browser bundles.

That gate works against the product's own safety advice. The README tells every operator to "check your output in an independent G-code viewer before running it", and PROJECT.md non-negotiable 9 says the in-app Abort is not a safety-rated stop. Looking at a program before it runs is checking, not production. A Free operator who wants to follow that advice has to leave KerfDesk to do it.

The Inspector is also the base of ADR-630 (running an external G-code file). Running a file without being able to see it first would be worse than not running it at all.

## Decision

1. `gcode-inspector` is no longer a Pro feature. **File → Open G-code...**, **Inspect G-code (3D)**, dropping a G-code file, and the canvas **G-code** view open in every edition with no trial or licence prompt and no "(Pro)" label.
2. The browser Free build keeps the Inspector's implementation. `InspectorView` and `CanvasGcodeView` leave `PRO_BUILD_ENTRIES` (ADR-540 Amendment 1); every other Pro entry stays replaced.
3. The Pro list and its copy (the Pro dialog, the website's feature list, the gap audit) stop naming the Inspector.

The rest of ADR-540 is unchanged: V-carve, 3D relief, adaptive clearing, advanced tracing, camera alignment, Registration Jig, Place Board, the box generator and Design Studio remain Pro. ADR-623 has since made the desktop app open behind a licence window with no Free edition, so the Free surface this decision governs is the browser app; in a desktop session the Inspector is no longer a Pro tool and opens without a Pro prompt. This decision adds no licence check.

## Consequences

- The browser Free bundle grows by the Inspector's chunks. They were already lazy-loaded on desktop and stay lazy-loaded.
- Projects that used the Inspector during a trial are unaffected: the Inspector never wrote anything into a project.
- No G-code, Frame, Start, output or controller behaviour changes.

## Verification

Unit tests prove the Pro feature list, the Pro command map and the browser build entries no longer include the Inspector, and that the Inspector command, the file-open route and the canvas G-code switch run without asking for Pro in a locked edition. The existing browser-Free build test keeps proving every remaining Pro entry is replaced.
