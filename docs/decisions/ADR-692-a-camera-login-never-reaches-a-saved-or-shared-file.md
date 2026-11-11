## ADR-692 - A camera login never reaches a saved or shared file

**Status:** Accepted. Fixes rolling audit v11 finding W4-P2-2 (P2, credential leak into persisted or
shared files, camera area; `docs/audits/2026-11-08-rolling-v11/W4-camera.md`). Builds on ADR-121 (the
loopback camera bridge), ADR-446 (several saved cameras per machine) and ADR-448 (the phone camera,
whose remembered address stays login-free). Burn, G-code, Frame, Start and licences are unchanged. |
**Date:** 2026-11-09

### Context

A network camera is named in its calibration by its address, and that name travels in every file
that carries the machine: projects, exported machine profiles, the remembered machine, saved
artwork and the camera's local reference view. The address was cleaned before it was saved, but the
cleaning did not cover every way a camera address can carry a login, so a login could still reach
those files. Projects and machine profiles are routinely shared.

### Decision

1. **One public form.** A camera address is saved or shared only in its public form
   (`publicCameraAddress`, `src/core/camera/camera-address-login.ts`): scheme, host, port and the part
   of the address before anything that can carry a login. Everything that names a saved camera goes
   through it: the live capture binding, the remembered RTSP and phone addresses, and the retired
   camera profile's stream address. When the public form cannot be told apart from a login with
   certainty, more is left out, never less.
2. **The keyed identity is unchanged.** A calibration still knows its camera by the app-keyed
   fingerprint (`queryFingerprint`), computed over the address as before. The key never leaves this
   computer, so the fingerprint shows nothing, and calibrations saved by older versions still match.
3. **Older files are cleaned when read.** Reading a capture binding keeps only the public form, so an
   older project, machine profile or remembered machine opens without the login and saves without
   it. Saving does the same again for any record held in memory. The remembered machine, saved
   artwork and the camera's reference-view keys are rewritten on this computer the first time they
   are read. A file already shared cannot be recalled; the release note tells camera owners to change
   that camera's password.
4. **Reconnecting uses secure storage only.** KerfDesk Desktop keeps the full remembered RTSP address,
   login included, only under the operating system's encryption (`electron/camera-address-store.ts`,
   the same check as the assistant's credentials: on Linux only a keyring's key counts). The window
   reaches it over one app route, `app://app/api/camera-address/rtsp`, with the route guard every app
   route uses. Without secure storage, and in the browser, nothing but the public form is kept, so a
   login is typed again, as before. The phone camera keeps ADR-448's rule: no login is remembered.

### Consequences

- A camera that takes its login inside its address reconnects by itself on the desktop, as it did,
  but its login no longer sits in plain local storage.
- An RTSP login typed as `user:password@` is now also remembered, in secure storage only; the camera
  panel's note says so.
- The readable camera name in a project can be shorter than the address typed. Which camera a
  calibration belongs to is decided by the keyed fingerprint, so two streams on one camera stay
  apart.
