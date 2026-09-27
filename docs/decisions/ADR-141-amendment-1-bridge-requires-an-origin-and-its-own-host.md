## ADR-141 Amendment 1 - The camera bridge requires an Origin and answers only to its own host names (2026-09-27)

**Status:** Implemented. | **Date:** 2026-09-27

### Context

ADR-141 says the loopback camera bridge accepts browser requests only from `app://app` and HTTP
loopback development origins. The desktop audit (`docs/audits/2026-09-27-electron-desktop-audit.md`,
item C1) found two ways around that, both confirmed against the running bridge:

- **No Origin was allowed.** `isAllowedBridgeOrigin(undefined)` returned true, on the reasoning
  that only a same-origin `app://app` document or a local non-browser client sends none. A plain
  `<img>` on any website also sends none, so any page open in any browser on the same PC could
  make the bridge run `/probe` (RTSP DESCRIBE, ffmpeg) and `/frame.jpg` (HTTP fetch) against
  addresses on the local network. Chrome 142's Local Network Access prompt covers Chrome only.
- **Any Host was served.** A page on a host name that resolves to `127.0.0.1` (DNS rebinding)
  is same-origin with the bridge, sends no Origin on GET, and can read every response, including
  camera frames and `/discover` results.

KerfDesk itself never sends a request without an Origin: its `fetch()` calls are cross-origin
from `app://app` (or the loopback dev page), and the camera `<img>` elements in
`CameraSourceView` load with `crossOrigin="anonymous"`. The one exception was the machine-camera
preview in `NetworkCameraView`.

### Decision

- Every request must carry a `Host` of exactly `127.0.0.1:<port>` or `localhost:<port>`
  (`isBridgeHost`), checked before anything else. This is Node's fix for DNS rebinding
  (CVE-2018-7160).
- A request with no `Origin` is refused with 403 before any work, like an untrusted Origin.
- `NetworkCameraView` loads its preview with `crossOrigin="anonymous"`, so it sends the page's
  Origin like the other camera images.

A per-launch bridge token was considered. It is not needed for this threat: with an Origin
required and the Host checked, a web page cannot produce a request the bridge accepts, and a
token readable by the renderer would add nothing against code already running in it (ADR-141).

### Consequences

- Scripts or tools that called the bridge without an `Origin` header must now send a trusted one
  (`app://app` or an HTTP loopback origin). The bridge's own tests do.
- The camera preview is unchanged for the operator.

### Verification

- `electron/rtsp-camera-bridge.test.ts` and `electron/camera-frame-proxy.test.ts`: no-Origin and
  foreign-Host requests get 403 before the camera is contacted; `localhost:<port>` with a trusted
  Origin gets 200.
- In the running desktop app (Electron 42.11.8, Linux): the page's `fetch()` and a
  `crossOrigin="anonymous"` image got 200; a plain `<img>` got 403; from outside the page, a
  rebound Host, a missing Origin and `https://evil.example` all got 403, and `app://app` got 200.
