# CNC Inlay Automation Acceptance

Date: 2026-07-13

## Accepted scope

KerfDesk now provides a straight-sided **Inlay pair (pocket + insert)** CNC cut type. One closed source shape compiles into a linked female pocket and male insert using the same end mill and radius-matched geometry.

The generated pair has these verified behaviors:

- the female pocket remains at the source location;
- the male insert is mirrored and placed to the right using the configured pair spacing;
- fit clearance is expressed in millimetres per side and is shared between the female expansion and male contraction;
- pocket depth and insert profile depth are independently configurable;
- the pocket is emitted before the insert profile;
- the insert profile supports holding tabs;
- invalid tools, open or unusable geometry, invalid depths, and invalid fit settings fail closed through `cnc-inlay-invalid` preflight findings;
- valid settings round-trip through `.lf2` normalization, while malformed optional settings are discarded.

## Evidence

Focused verification passed 77 tests across inlay geometry, CNC compilation, multi-tool ordering, CNC preflight, project serialization, and layer controls.

`corepack pnpm release:check` passed in 493.4 seconds. The gate included repository identity, TypeScript, ESLint, Electron lint, Prettier, production dependency licenses, dependency audit, the full Vitest suite, Playwright, web and Electron builds, and file-size guards.

Browser acceptance used a 30 x 30 mm rectangle, the 3.175 mm active end mill, a 3 mm pocket depth, 6.35 mm insert depth, 0.1 mm/side fit clearance, 10 mm pair spacing, and four holding tabs. Preview compiled successfully and reported 1,911.2 mm cut distance, 846.2 mm travel, 499.0 mm plunge, and a 3m 7s estimate. The reopened acceptance build reported no browser warnings or errors.

## Reference basis

The implementation follows the same-tool and radius-compensation requirements documented for straight inlays by Vectric. The separate V-carve inlay documentation was used to define the boundary between straight-sided and tapered inlay workflows:

- [Vectric VCarve Inlay Toolpath](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/VCarve%20Inlay%20Toolpath/)
- [Vectric V-carve Inlay Plug](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/vcarve-inlay-toolpath-plug/index.html)

## Remaining boundary

This acceptance closes straight-sided inlay automation only. It does not claim tapered V-carve inlay automation. A future tapered workflow must explicitly model glue gap, surface clearance, pocket depth, and plug stock depth; the current ring-based V-carve operation is not repurposed for that claim.

The CNC sector should not be rescored above 9 from this ticket alone. Drag-placeable tabs and the final sector acceptance rerun remain open.
