## ADR-448 - A phone as the overhead camera (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

Many hobby lasers have no camera, and the best camera most owners already have is their phone.
Its sensor and lens beat a typical 720p or 1080p USB webcam, and it is free. The camera plan's
batch 6 asked for a phone as the overhead camera.

A phone can reach KerfDesk in three ways:

- **As a webcam.** Continuity Camera on a Mac, or a webcam app with its computer driver, makes
  the phone a USB camera. That already works in the browser and in Desktop, with nothing new.
- **A web page on the phone.** The phone's browser may only open its camera on a secure page
  (https or localhost). A page that Desktop serves on the local network is plain http, so the
  phone refuses it. A self-signed certificate brings a warning on every visit, and streaming
  video needs a WebRTC connection set up between the two devices.
- **A camera app that serves pictures on the local network.** IP Webcam on Android serves the
  current picture at `http://<phone>:8080/shot.jpg`, and many other apps serve a picture address.
  KerfDesk Desktop's camera bridge already reads a laser's built-in camera this way (ADR-116): it
  accepts private-network http addresses, sends one request at a time per camera, and caps a
  picture at 8 MiB.

The third way needs no pairing and no new server, and it reuses a path that already works on
real hardware.

### Decision

1. **Phone camera section.** The Camera panel in Desktop (wherever the bridge runs) gets a
   **Phone camera…** section beside **RTSP camera…**. The operator picks the app:
   - **IP Webcam (Android)**: type the address the app shows (`192.168.1.50:8080`, a bare
     address, or with `http://`). KerfDesk fetches `/shot.jpg`, on port 8080 unless another is
     given.
   - **Another app with a picture address**: type the full http address of its still picture.
   A video stream (`rtsp://`) address is sent to **RTSP camera…**, which already reads those.
2. **One more still-picture source.** **Use phone** starts the same kind of source as the laser's
   built-in camera, read through the bridge. It fetches a new picture every 500 ms instead of
   every 1.5 s, because a phone answers much faster than the laser's camera. Starting fetches
   one picture first, so a wrong address or a stopped app says so instead of showing a blank
   preview. The machine camera's **In use** mark now checks the address, so a running phone
   does not mark the laser's camera as in use.
3. **Its own calibration.** The phone is a camera like any other (ADR-446). Its calibration is
   bound to its address (plus a keyed fingerprint of any query), and **Calibrated cameras** names
   it **Phone camera at** its address.
4. **Remembered public address, never credentials.** Like the RTSP preference, storage strips
   userinfo, query and fragment, including legacy stored values. The full typed address is used
   for the current connection; the panel explains that login details and query parameters must
   be entered again later. HTTP userinfo is decoded into a Basic Authorization header in the
   bridge, not passed to Fetch in the URL. Redirects remain refused and errors never echo the
   credential-bearing URL. Authentication modes beyond HTTP Basic are not added here.
5. **Setup steps.** The section lists what makes a phone a good bed camera: the largest video
   resolution (IP Webcam serves its pictures at that size), mounted straight down clear of the
   head and gantry, no zoom, stabilisation, HDR or filters, focus locked where the app allows,
   on its charger with the screen kept awake, and calibrated once mounted.
6. **Hosted web app.** A phone camera app is a local-network camera like the laser's own, so the
   hosted app cannot read it. Its camera notice now says so, and says that a phone that shows up
   as a webcam works there too.

No new gate: a phone camera shows the same factual messages as any other camera.

### Consequences

- A phone is a strong camera for most owners, at no cost. Pictures come from the app's video
  stream, which is fast. The app's full photo resolution refocuses on every shot and is not used.
- A phone that moves invalidates its calibration. Check camera (ADR-441 Amendment 1) shows the
  drift, and the setup steps say so.
- KerfDesk does not search the network for phones. The operator types the address the app
  shows, once.
- iPhones have no built-in picture server. They work through an app that serves a picture
  address, or as a webcam through Continuity Camera on a Mac.
