## ADR-540 - KerfDesk Free and Pro: the app always opens, only Pro tools need a licence (2026-09-29)

**Status:** Implemented for the commercial desktop build; web licensing planned | **Date:** 2026-09-29 | **Amends:** ADR-523 (launch admission and update eligibility)

### Context

ADR-523 prepared a commercial desktop build that admitted nobody to the workspace
without a trial, a paid licence or a developer licence. On 2026-09-28 the owner
replaced that with two editions on both the browser and desktop apps: a Free tier
with the basic functions, and Pro unlocked by a licence key after a one-month trial
per device. On 2026-09-29 he approved this split:

- **Free**, on the web and the desktop: drawing, text, import, basic tracing, laser
  cut and engrave, 2D CNC cuts and all machine control.
- **Pro**: V-carve, 3D relief, adaptive clearing, advanced tracing, camera
  alignment, the box generator, Design Studio and the G-code Inspector.

The rest of ADR-523's offer is unchanged: US$49.50 once for three devices and a
year of updates, an optional US$20 further year, a 30-day trial per device, and
two developer licences. PROJECT non-negotiable #21 (Frame is the only Start guard)
still holds.

### Decision

1. **The app always opens.** There is no activation screen and no admission step.
   A commercial build without a licence runs KerfDesk Free. The workspace, projects,
   camera and serial port never wait for the licence service or the saved licence.
   ADR-523's pre-workspace admission, its session latch and the camera and serial
   permission holds that depended on it are removed.
2. **Only opening a Pro tool asks for a licence.** Each Pro tool checks the edition
   where it is opened or chosen, through `requestProFeature` in
   `src/ui/licensing/edition.ts`. Without Pro it shows one dialog that names the tool
   and offers the trial, Buy Pro and "I have a licence key". If Pro becomes
   available from that dialog, the tool opens.
3. **Output is never gated.** Preview, estimates, Frame, Start and Save G-code read
   the project and never check the edition. A project that already holds a V-carve,
   relief or adaptive operation still runs in Free. A Pro option already chosen on
   a layer stays shown and editable; only choosing it anew asks for Pro. A licence
   change never stops a running job.
4. **Pro stays for the session.** Once Pro is available in a running app, it stays
   until the app closes, even if a trial ends or the clock or updates coverage
   changes. Deactivating this device is the owner's own act, so it locks Pro at
   once.
5. **Updates follow the edition.** A device without a licence, or whose trial has
   ended, runs Free and takes the newest signed release. A paid device only takes
   releases its update period covers, so an automatic update never takes its Pro
   tools away. Installed by hand, a newer release opens as Free with a message
   naming the update date.
6. **Builds without licensing keep every tool until sales open.** Preview, source
   and web builds have no licence adapter, so `requestProFeature` allows. The
   launch that enables checkout switches them to KerfDesk Free, with Pro tools
   pointing to the desktop app (ADR-544 item 1); locking them before a licence can
   be bought would leave nobody able to unlock Pro.
7. **Planned web licensing.** When it ships, a browser counts as one of the
   licence's three devices, its Pro tools work while the licence's update period
   is active (the web app is always the newest version), and a web trial is per
   browser profile.
8. **The status bar names the edition** ("Free · Try Pro", "Pro trial · N days
   left", "Pro", "Free") in commercial builds and opens Help > Licence.

### Consequences

- `CommercialLicenceGate` becomes `EditionProvider`. `LicenceStatus` gains
  `edition`, and `sessionAuthorized` and the `launch` route are gone.
- The Pro tool list lives in `src/ui/licensing/pro-features.ts`. Adding a Pro tool
  means adding it there and calling `requestProFeature` where it opens.
- The Pro check is a local convenience, not DRM, as ADR-523 already says of the
  licence checks.
- Any change to which tools are Free or Pro needs the owner's word.
