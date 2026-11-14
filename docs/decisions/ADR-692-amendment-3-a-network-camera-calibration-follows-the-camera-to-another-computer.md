## ADR-692 Amendment 3 - A network camera's calibration follows the camera to another computer (2026-11-14)

**Status:** Accepted. These are the maintainer's choices on camera audit v2 K5-P3-3 and K5r-P3-4,
relayed by the audit coordinator:
- for the first use on another computer, **"Notice + Check camera (Recommended)"**;
- for the portable identity, **"Yes, slow hash (Recommended)"**.

This amends ADR-692 Decision 2, which kept the per-computer key on purpose, and its Consequence that
"which camera a calibration belongs to is decided by the keyed fingerprint". Unit evidence only: no
camera and no network were used, and every login in the tests is synthetic. | **Date:** 2026-11-14

### Context

A calibration knows its network camera by a fingerprint keyed with a secret that never leaves this
computer (ADR-692 Decision 2). That keeps the address's path and query private, but it also means a
calibration made on one computer never matches the same camera on another. A project or machine
profile opened on a second computer silently fell back to "this calibration belongs to another
camera", and a changed camera password also made the camera look new (K5r-P3-4).

The maintainer chose the following:
- (a) the same camera at the same address keeps its calibration on another computer. On first use
  there, KerfDesk says so and asks for Check camera. A check that passes starts this computer's own
  reference view. No picture goes into project or machine files.
- (b) a slow, fixed-salt PBKDF2 hash of the address without its login is saved beside the keyed
  fingerprint, so the path (recorder channels, tokens) counts without being revealed.

### Decision

1. **A portable identity beside the keyed one.** A network camera's capture binding also keeps
   `portableFingerprint`. This is PBKDF2-SHA-256 with a fixed salt and 200,000 iterations, written
   as `pbkdf2-sha256:<64 hex>`. It is taken over the address with every login removed: the
   userinfo, login-shaped query fields (`user`, `username`, `login`, `pass`, `password`, `pwd`,
   `passwd` and similar) and login fields written into the path (`user=…_password=…`). The scheme,
   host, port, the rest of the path and the rest of the query stay in it, so two channels of one
   recorder stay apart. The keyed fingerprint is unchanged, so every existing calibration still
   matches on the computer that made it.
2. **How a saved camera matches.** The keyed fingerprints agreeing is the same camera on this
   computer. Otherwise, the portable fingerprints agreeing is the same camera seen from elsewhere:
   another computer, or the same one after a password change. Anything else is another camera.
   Bindings without either fingerprint are read as before.
3. **First use elsewhere asks for Check camera.** The Camera panel shows "This camera was calibrated
   on another computer: run Check camera once" while two things hold: the running camera's
   calibration matched only by the portable identity, and this computer keeps no reference view
   for it. A check that finds the camera where it was (or Fix a small offset) keeps a reference
   view on this computer, as before, and the notice goes. Dismiss hides it until KerfDesk is opened
   again. The reference view stays on this computer only; no picture is saved in a project or
   machine file.
4. **Still no login in any saved file (#1649).** The portable fingerprint is a slow one-way hash of
   an address that holds no login. The saved camera name stays the public form (ADR-692 Decision
   1).

### Consequences

- A project or machine profile opened on another computer uses its network camera's calibration,
  after a notice that asks for one check.
- A camera password change, in the address, the query or the path, no longer makes the camera look
  new.
- The saved path and query can be guessed only by trying candidates against a slow hash. A short or
  common path (`/live`, `channel=1`) can be guessed this way. That was accepted: the address holds
  no login, and the maintainer chose path matching over keeping it private.
- A calibration saved before this amendment has only the keyed fingerprint, so it stays tied to the
  computer that made it until it is calibrated or checked again there and saved.

### Verification

`src/ui/state/camera-portable-identity.test.ts`:
- the same camera and address under a second identity key matches, and is reported as made
  elsewhere;
- another path or query at the same address does not match;
- a password change in the address, the query or the path keeps the match;
- the hash is PBKDF2 over the login-free address only;
- a saved binding holds no login, path or query.

`src/ui/camera/panel/CameraElsewhereNotice.test.tsx`: the notice shows for a calibration made
elsewhere, goes once a check keeps a view here, and stays away for a calibration made on this
computer.

`src/ui/state/camera-query-binding.test.ts` now expects the new rule: a lost app-local key
matches the same camera and address by the portable identity, and another channel still does not.
Its legacy fixture drops both fingerprints. `camera-store.test.ts` expects the portable identity
on found and RTSP sources. The other camera binding, saved-camera and identity tests are unchanged
and pass.
