## ADR-692 Amendment 1 - Camera logins stay out of process lists, saved files and plain-text requests (2026-11-10)

**Status:** Accepted; unit evidence with stand-in RTSP and HTTP cameras on 127.0.0.1, a recorder
in place of FFmpeg and synthetic logins only. No camera, network or FFmpeg was used. | **Date:**
2026-11-10

Follows rolling audit v13 area Y2 (camera connection and login): Y2-P2-1, Y2-P3-2 and Y2-P3-3
(each P2), with Y2-P3-1, Y2-P3-4 and Y2-P3-5. Details stay out of the repository until this lands,
under the audit's disclosure rule. Amends Decisions 1 and 4, and widens ADR-448 Decision 4 for the
phone camera.

### Context

ADR-692 kept camera logins out of saved and shared files and out of plain local storage. The
audit found three further ways a camera credential could reach someone it was not meant for:

- another program on the same computer, through the arguments of a process the bridge starts;
- a saved or shared file, through parts of a camera address that Decision 1's public form kept;
- the local network in clear text, where the camera had offered a safer way to log in.

It also found that an address that reads more than one way could leave part of a login in plain
local storage, that a refused login was retried several times a second, and that a refused login
was reported as a missing picture.

### Decision

1. **The public form is scheme, host and port** (amends Decision 1). `publicCameraAddress` keeps
   nothing of the path, query or fragment. Which camera a calibration belongs to is still decided
   by the keyed fingerprint (Decision 2), which is unchanged, so calibrations saved before match.
   An address that does not read one way only keeps its scheme alone. The camera's reference view
   is kept per public address and fingerprint.
2. **Plain local storage keeps only the public form; secure storage keeps the rest** (amends
   Decision 4). The desktop's secure storage now has two slots: the RTSP address in full, and the
   phone camera's address without its login (ADR-448 still remembers no phone login). An older
   plain copy moves into secure storage when it is read, without replacing a kept address for the
   same camera.
3. **No camera address in a process's arguments.** FFmpeg opens a single-use relay on 127.0.0.1
   with a random path (`electron/rtsp-login-relay.ts`). The relay connects to the camera, answers
   its login challenge, and passes the stream through; it takes one connection and stops listening.
4. **A login is sent only when the camera asks, in the strongest form it offers.** The bridge's
   snapshot fetch, its RTSP probe and the relay share one answerer
   (`electron/camera-login-answer.ts`): Digest (MD5, SHA-256, either with `-sess`) whenever the
   camera offers a Digest it can compute, Basic only when Basic is all it offers, and never Basic in
   place of a Digest. A camera that answers without asking receives no login.
5. **A failing camera is left alone, and a refused login stops.** The bridge waits before asking a
   camera that just failed again, longer after each failure, and stops asking after a login problem
   until the camera is connected again. The panel names a missing, refused or unsendable login.

### Consequences

- An RTSP preview and every still now pass through the relay. It has been exercised against
  stand-in cameras only; a check on real cameras is owed before release.
- A camera whose only login is one the bridge cannot send fails with that reason instead of
  connecting.
- The readable camera name in a project is its host and port.
- An `rtsps://` camera is still refused by the bridge's policy, unchanged here.
