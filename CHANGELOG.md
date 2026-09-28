# Changelog

What changed in each KerfDesk desktop release. The web app updates from `main` as changes land;
desktop Previews are tagged from `main` (ADR-522, and "Desktop Preview releases" in `WORKFLOW.md`).

Highlights are written by hand. **All changes** is generated from the merged pull requests by
`node scripts/desktop-release-notes.mjs refresh`, and `stamp <version>` turns Unreleased into a
release before it is tagged.

## Unreleased

### Highlights

- **Laser tabs and start points.** Tabs by spacing, burned at a lower tab power or placed by hand,
  and a choice of where closed shapes start
  ([#996](https://github.com/cisgz3a-hub/KerfDesk/pull/996)).
- **Moving the head.** Move the laser to the selection, type a position to move to, save
  positions, choose where the head finishes, and jog with the keyboard
  ([#985](https://github.com/cisgz3a-hub/KerfDesk/pull/985)).
- **Recovery after a lost connection.** Review shows where the job stopped; continue from where
  the head stopped or go back to the saved origin
  ([#969](https://github.com/cisgz3a-hub/KerfDesk/pull/969),
  [#990](https://github.com/cisgz3a-hub/KerfDesk/pull/990)). Very large photo jobs, and jobs that
  finish in a hidden browser tab, now get the second-pass offer too
  ([#1000](https://github.com/cisgz3a-hub/KerfDesk/pull/1000)).
- **Falcon air assist** stays on through long jobs
  ([#968](https://github.com/cisgz3a-hub/KerfDesk/pull/968)).
- **Bidirectional scanning** with timing compensation
  ([#963](https://github.com/cisgz3a-hub/KerfDesk/pull/963)).
- **LightBurn-style tools.** Roller rotary scaling, Recent Projects, QR codes and barcodes
  ([#904](https://github.com/cisgz3a-hub/KerfDesk/pull/904)), editing tools, perforation, overcut
  and image overscan ([#933](https://github.com/cisgz3a-hub/KerfDesk/pull/933)).
- **3D relief carving (CNC).** Exact contact, linked finishing, waterline and linked roughing
  ([#939](https://github.com/cisgz3a-hub/KerfDesk/pull/939),
  [#973](https://github.com/cisgz3a-hub/KerfDesk/pull/973)), masked reliefs
  ([#980](https://github.com/cisgz3a-hub/KerfDesk/pull/980)), and faster roughing that rapids down
  through cleared air ([#988](https://github.com/cisgz3a-hub/KerfDesk/pull/988)).
- **CNC pause.** Pause lifts the bit out of the cut and Resume re-enters from above
  ([#936](https://github.com/cisgz3a-hub/KerfDesk/pull/936),
  [#993](https://github.com/cisgz3a-hub/KerfDesk/pull/993)). V-carve jobs compile faster
  ([#958](https://github.com/cisgz3a-hub/KerfDesk/pull/958)).
- **Cameras.** Rebuilt calibration and overlay
  ([#944](https://github.com/cisgz3a-hub/KerfDesk/pull/944)), several cameras per machine
  ([#964](https://github.com/cisgz3a-hub/KerfDesk/pull/964)), and a phone as the overhead camera
  ([#977](https://github.com/cisgz3a-hub/KerfDesk/pull/977)).
- **G-code Inspector.** Any G-code in 3D with playback, time by move kind and a health report
  ([#409](https://github.com/cisgz3a-hub/KerfDesk/pull/409),
  [#416](https://github.com/cisgz3a-hub/KerfDesk/pull/416),
  [#444](https://github.com/cisgz3a-hub/KerfDesk/pull/444)); point at, measure and isolate moves
  ([#966](https://github.com/cisgz3a-hub/KerfDesk/pull/966)); big files stay smooth
  ([#983](https://github.com/cisgz3a-hub/KerfDesk/pull/983)).
- **Tracing and text.** Colour layers, line and fill, native arcs and vector export
  ([#943](https://github.com/cisgz3a-hub/KerfDesk/pull/943),
  [#950](https://github.com/cisgz3a-hub/KerfDesk/pull/950)), photo shading for portraits
  ([#849](https://github.com/cisgz3a-hub/KerfDesk/pull/849)), and text edited right on the canvas
  with more bundled fonts ([#785](https://github.com/cisgz3a-hub/KerfDesk/pull/785)).
- **Connecting.** Connect remembers the port, and Machine Setup opens with Find my machine
  ([#941](https://github.com/cisgz3a-hub/KerfDesk/pull/941)).
- **Desktop app.** Electron 44 with Chromium 152; the Mac Preview now needs macOS 13 Ventura or
  newer ([#998](https://github.com/cisgz3a-hub/KerfDesk/pull/998)). A smaller, locked-down package,
  outside links open in the browser, and a crashed window offers to reload
  ([#984](https://github.com/cisgz3a-hub/KerfDesk/pull/984)). Serial access is granted only to the
  port you pick ([#884](https://github.com/cisgz3a-hub/KerfDesk/pull/884)).

### All changes

<!-- changes:start -->
<!-- changes:end -->

## 0.2.0-preview.13 - 2026-07-23

The first public desktop Previews: an unsigned Windows x64 installer and macOS DMGs for Intel and
Apple silicon, published with checksums, an SBOM and build attestations. Previews 1 to 12 were the
same day's release-lane rehearsals; Previews 9, 10 and 13 were published.

## 0.1.1 - 2026-07-12

Windows release packaging fix ([#55](https://github.com/cisgz3a-hub/KerfDesk/pull/55)).

## 0.1.0 - 2026-07-12

The first tagged build.
