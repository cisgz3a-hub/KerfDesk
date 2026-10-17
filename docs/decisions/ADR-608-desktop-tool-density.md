## ADR-608 - Desktop-tool density: LightBurn-sized chrome

**Status:** Accepted.

## Context

On a small laptop the workspace chrome took most of the window. A 1920 × 1080 laptop at Windows' recommended 150 % scaling gives the app about 1280 × 680 CSS pixels. At that size the menu bar, toolbar, transform bar, machine bar, view switch, sheet bar and status bar stacked 289 px of bars around the canvas, and the side panel took 401 px. The canvas got 829 × 391 px, about 37 % of the window. The maintainer asked for the interface to be sized the way LightBurn sizes its own.

LightBurn is a Qt application. Its window text uses the OS UI font at its default size, Segoe UI 9 pt on Windows, which is 12 px at 100 % scaling. Its Display settings offer a Font Size slider (Default, or 8–24) and a Toolbar Icon Size slider (Smallest to Largest) as the manual overrides for HiDPI screens and low vision ([Settings Window](https://docs.lightburnsoftware.com/UI/NewSettingsWindow.html)). Windows display scaling multiplies everything. The 1272 × 838 main-window capture in LightBurn's documentation ([Overview](https://docs.lightburnsoftware.com/legacy/UI/)) shows roughly a 20 px menu bar, 20–30 px toolbar rows with 16–24 px icons, a ~40 px tools column, and docked panels around 300–380 px wide. The canvas gets more than half the window.

KerfDesk's type scale started at 15 px body text, with 36–40 px controls and 5–12 px bar padding, which is closer to a touch-first web app than to a desktop CAM tool.

## Decision

1. **Type scale** (`tokens.css`): `--lf-text-xs/sm/md/lg/xl` move from 12/14/15/16/18 px to **11/12/13/14/16 px**. Labels, inputs and toolbar text use 12 px, LightBurn's size. Body text uses 13 px, one step above it. Components that read the tokens follow automatically.
2. **Control heights**: desktop chrome controls are **24–30 px** tall. Toolbar buttons are 28 px, transform inputs and sheet tabs 24 px, machine-bar controls 28 px, rail tools 30 px, and Frame / Start 30 px. Interactive targets stay at least 24 × 24 px (WCAG 2.2 target size, AA). Coarse pointers keep the existing 44 px Frame / Start rule, and the ≤ 700 px narrow-window rules keep their 32 px targets.
3. **Bar heights** at 1280 × 680: menu bar 29 px, toolbar 34 px, transforms and machine controls 35 px (one row), view switch 27 px, sheet bar 30 px, status bar 24 px. That is 179 px of bars, down from 289 px.
4. **Transforms and machine controls share one row from 1141 px** (previously 1240 px), so a 1280 px laptop no longer spends a second 47 px row on Laser / CNC, the machine and Connect.
5. **Widths**: the tools column is 40 px (was 50 px; 52 px while curve actions show). The Compact side panel is `clamp(290px, 27vw, 360px)` (was `clamp(320px, 34vw, 400px)`). Spacious keeps its 300 px panels.
6. **Panel contents**: the Artwork panel heading, view tabs, operation card, Line / Fill / Image switch, slider fields and panel-wide inputs shrink to the same 24–28 px scale.
7. **Frame and Start stay pinned.** When a short window makes the Compact side panel scroll, the job dock sticks to the panel's bottom edge. Frame and Start stay fully visible instead of scrolling away, or ending up a fraction of a pixel past the edge when a scroll stops on a whole pixel.

At 1280 × 680 the canvas grows from 829 × 391 px to 893 × 501 px (+38 % area). At 1366 × 768 it grows from 915 × 521 px to 965 × 589 px (+19 %).

There is no in-app UI size setting yet. Users who want larger text can use Windows display scaling, browser zoom, or Electron's View → Zoom, as with any desktop tool. A LightBurn-style Font Size / Icon Size preference could be a later decision.

## Consequences

The workspace reads as a desktop tool: more canvas, more commands visible before the toolbar overflows, and more operation settings visible without scrolling. Text is smaller. At 150 % Windows scaling, 12 px labels render at 18 physical pixels, the same as LightBurn's labels on that screen.

Dialogs that use the shared tokens get the denser type too. Dialog layout, spacing and widths are unchanged.

The smaller line heights are fractional (13 px × 1.4 = 18.2 px, where 15 px × 1.4 was a whole 21 px). In the G-code Inspector they left the 3D view, and the readout card drawn over its WebGL canvas, at a fractional pixel offset. On Linux CI, Chrome's software compositor then blended the card's edge one level differently from frame to frame, which broke the Inspector's pixel-exact playback test. The Inspector panel now rounds its size to whole, even pixels, and its two header rows have whole-pixel minimum heights (42 px and 62 px). That puts the 3D view on a pixel boundary.

No job output, Frame, Start, controller or licence behaviour changes.

## Verification

Measured in Chrome at 1141, 1100, 1280 × 680, 1366 × 768, 1920 × 1080, 900 × 600 and 640 × 450. The one-row and two-row topbar layouts switch cleanly at the breakpoint, and no bar overflows the window. The tool-strip unit test now pins the 40 px column and 30 px buttons.
