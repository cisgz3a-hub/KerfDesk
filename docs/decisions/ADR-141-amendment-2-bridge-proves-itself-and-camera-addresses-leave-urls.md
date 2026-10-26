## ADR-141 Amendment 2 - The camera bridge proves it is KerfDesk's, and camera addresses leave URLs (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

### Context

The camera bridge listens on a fixed loopback port, `127.0.0.1:51731`. Amendment 1 made it refuse
requests that carry no Origin or a foreign Host, and it considered a per-launch token
unnecessary: "a web page cannot produce a request the bridge accepts". That reasoning covered
requests made **to** the bridge. Nothing covered who **answers** on the port.

Rolling audit v2, finding 04-P2-1, confirmed by two refuters, reproduced the result. Loopback
ports are shared by every program and Windows account on the PC.

1. Any program that listens on `127.0.0.1:51731` before KerfDesk makes the bridge fail to start.
   Main only logged the failure (`camera-bridge-lifecycle.ts`).
2. The window still sent the RTSP probe there, and the camera's login went with it, in the URL:
   `GET /probe?url=rtsp%3A%2F%2Fadmin%3AS3cret%40…`. The program received the login and could
   return any frames it liked. The `<img>` URLs for `/stream.mjpg` and `/frame.jpg` carried the
   address, login included, the same way.
3. A program that did not answer like the bridge got the operator told that network cameras
   need "KerfDesk Desktop or local development", while they were running KerfDesk Desktop.

The audit's Known item B-1 adds that the bridge served any `http://localhost:*` page, also in
packaged builds, which need only `app://app`.

### Decision

1. **Per-launch keys.** At launch, main makes two random 32-byte values (`createCameraBridgeKeys`):
   a **proof key** and a **client token**. It gives them only to its own window, over a new
   `app://app/api/camera-bridge/connection` route. That route makes the same checks as the other app
   routes (`trustedAppRequest`, its own `X-KerfDesk-Camera-Bridge` header), so no web page or other
   program can read the keys.
2. **The bridge proves itself first.** Before each request that names a camera (probe, frame-source
   registration, discovery), the window sends `/health?challenge=<32 random bytes>`. The bridge
   answers with `HMAC-SHA256(proof key, "kerfdesk-camera-bridge-proof/1:" + challenge)`. The window
   checks the answer with WebCrypto. A missing or wrong proof stops the request there, and the
   operator reads: "Another program is answering on the port KerfDesk uses for network cameras,
   so KerfDesk did not send it the camera's address or login." The proof key itself never goes to
   the bridge's port.
3. **Only KerfDesk names cameras.** A bridge with keys answers only `app://app` (B-1). It refuses
   `/probe`, `/frame-source` and `/discover` unless the request carries the client token in
   `X-KerfDesk-Camera-Bridge-Token`. The token is sent only after a proof.
4. **Camera addresses leave URLs.** The window sends a camera address once, in a POST body: to
   `/probe` for RTSP, or to the new `/frame-source` for a snapshot camera or an RTSP still. The
   bridge answers with URLs that name the camera by a random id. `/stream.mjpg?session=<id>` looks
   the camera up from its probe session. `/frame.jpg?source=<id>` looks it up from a registry of at
   most 32 sources. `/discover` registers what it finds the same way. `/frame.jpg?url=` and
   `/stream.mjpg?url=` are gone. The image routes and `/stream-status` need no token, because an
   `<img>` cannot send a header and an id is worth nothing outside one run of the bridge.
5. **A bind failure is told as it is.** The lifecycle keeps the reason a start failed and reports
   it through the connection route:
   - `EADDRINUSE`: another program, possibly KerfDesk open for another Windows user, holds the port.
   - `EACCES`: Windows has set the port aside, or security software blocks it.
   - Anything else: a plain restart message with the error code.

   Each camera connect asks main again, and that retries a bridge that is wanted but could not
   start, so closing the other program is enough.
6. **Local development is unchanged in trust.** `pnpm camera:bridge` and a dev-server window have no
   main process to hand keys over, so their bridge has no keys and keeps trusting the loopback
   development origins, as before. Camera addresses leave URLs there too.

### Consequences

- In the desktop app, a program that takes the bridge's port first gets no camera address and no
  login. The operator is told what happened and what to do.
- The port stays `51731`, so the CSP, the privacy page and the development flow do not change.
- A bridge restart (the window behind the licence window, a renderer crash) keeps this launch's
  keys but clears the frame-source registry and the preview sessions. The camera sources of the
  window that lost its workspace stop with it anyway. Within a run, the `<img>` requests
  themselves are not proven. A program would have to take the port while KerfDesk's own bridge
  holds it, which the operating system does not allow.
- The proof label and the token header are written in both `electron/camera-bridge-keys.ts` and
  `src/platform/web/camera-bridge.ts`, because neither tree may import the other.
  `electron/cross-surface-parity.test.ts` keeps them equal.

### Verification

- `electron/camera-bridge-keys.test.ts`: a keyed bridge answers a challenge with the right HMAC,
  refuses camera requests without the token or with the proof key in its place, refuses a
  loopback development origin, and takes RTSP addresses only in a POST body.
  `electron/camera-frame-proxy.test.ts`: registered cameras are named by id; a `url=` frame
  request is not served.
- `src/platform/web/camera-bridge.keyed.test.ts` replays the audit's repro with a fake bridge.
  Against a program that gives no proof, or signs with another key, the window sends only
  `/health` and no login. When main reports the port taken, the window contacts nothing and shows
  main's reason.
- `electron/camera-bridge-lifecycle.test.ts` and `electron/camera-bridge-routes.test.ts`: the real
  bind failure reaches the window, and a retry starts the bridge once the port is free.
- Code and test evidence only. No camera was connected and the packaged app was not run.
