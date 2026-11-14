## ADR-692 Amendment 2 - The camera login relay serves only the FFmpeg KerfDesk started (2026-11-14)

**Status:** Accepted (camera audit v2 finding K5-P2-1, a security finding raised to P2 by the
area's independent refuter and confirmed by the audit coordinator; the maintainer's standing
instruction to fix confirmed audit findings). Amends Amendment 1, Decision 3. | **Date:** 2026-11-14

### Context

Amendment 1 keeps a network camera's login out of FFmpeg's arguments with a single-use relay on
127.0.0.1. The audit found that another program on the same computer could briefly use a network
camera's login through KerfDesk, without learning it (CWE-441). No password, token or key was
disclosed. The details stay out of the public record until this change is released.

### Decision

The relay serves only the FFmpeg that KerfDesk started for it, and only that camera. It refuses
anything else without contacting the camera.

### Consequences

- Another program on the same computer cannot use a network camera's login through KerfDesk.
- KerfDesk's own camera stills and previews are served as before.
- Code and stub evidence only (servers on 127.0.0.1). No real camera or network was used.

### Verification

`electron/rtsp-login-relay.test.ts`: the relay serves the stream it was opened for, and nothing else.
The test fails on the previous code.
