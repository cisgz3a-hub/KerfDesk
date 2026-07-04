# RTSP Camera Bridge V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let LaserForge model and test CV40PRO-style RTSP cameras that appear as USB RNDIS network devices instead of browser webcams.

**Architecture:** Store camera source metadata in the machine profile. Browser webcams keep using `getUserMedia`; RTSP cameras use a local desktop bridge endpoint that can probe RTSP now and convert to MJPEG when FFmpeg is available. The web build reports bridge availability honestly instead of promising a browser camera picker can see RTSP.

**Tech Stack:** TypeScript, React, Electron main process, Node `http`/`net`/`child_process`, Vitest.

---

### Task 1: Camera Source Model

**Files:**
- Modify: `src/core/camera/camera-profile.ts`
- Modify: `src/core/camera/index.ts`
- Test: `src/core/camera/camera-profile.test.ts`
- Test: `src/io/project/project-camera-profile.test.ts`
- Test: `src/io/machine-profile/machine-profile-camera.test.ts`

- [ ] Add `CameraSource = { kind: 'browser' } | { kind: 'rtsp'; url: string }`.
- [ ] Default missing source to browser for old projects.
- [ ] Reject malformed RTSP URLs.
- [ ] Verify `.lf2` and `.lfmachine.json` roundtrip RTSP source metadata.

### Task 2: Platform Bridge Contract

**Files:**
- Modify: `src/platform/types.ts`
- Create: `src/platform/web/camera-bridge.ts`
- Modify: `src/platform/web/web-adapter.ts`
- Test: `src/platform/web/camera-bridge.test.ts`

- [ ] Add a `CameraBridgeAdapter` with `probeRtspCamera()` returning any bridge preview URL in the probe result.
- [ ] Implement the web adapter as a localhost bridge client at `http://127.0.0.1:51731`.
- [ ] Return `unavailable` when the desktop bridge is not running.

### Task 3: RTSP Camera Setup UI

**Files:**
- Modify: `src/ui/laser/MachineSetupCamera.tsx`
- Modify: `src/ui/laser/MachineSetupCameraPreview.tsx`
- Test: `src/ui/laser/MachineSetupCameraPreview.test.tsx`
- Test: `src/ui/laser/MachineSetupDialog.test.tsx`

- [ ] Add source selector: Browser camera or RTSP/network camera.
- [ ] Show RTSP URL field for network cameras.
- [ ] Show an RTSP bridge preview panel that probes the stream and shows MJPEG preview only when a bridge preview URL is available.

### Task 4: Electron Local Bridge

**Files:**
- Create: `electron/rtsp-camera-bridge-policy.ts`
- Create: `electron/rtsp-camera-bridge-policy.test.ts`
- Create: `electron/rtsp-camera-bridge.ts`
- Modify: `electron/main.ts`
- Modify: `electron/csp-policy.test.ts`

- [ ] Allow only `rtsp://` URLs on loopback/private IP ranges.
- [ ] Add `/health`, `/probe?url=...`, and `/stream.mjpg?url=...`.
- [ ] Use Node RTSP `DESCRIBE` for probe status.
- [ ] Use FFmpeg only when available for MJPEG streaming.
- [ ] Start the bridge in Electron on `127.0.0.1:51731`.

### Verification

- [ ] `pnpm test --run src/core/camera src/io/project/project-camera-profile.test.ts src/io/machine-profile/machine-profile-camera.test.ts src/platform/web/camera-bridge.test.ts src/ui/laser/MachineSetupCameraPreview.test.tsx src/ui/laser/MachineSetupDialog.test.tsx electron/rtsp-camera-bridge-policy.test.ts electron/csp-policy.test.ts`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm lint:electron`
- [ ] `pnpm build:electron-main`
- [ ] `pnpm build:web`
- [ ] Browser smoke: RTSP source shows bridge status instead of browser camera picker.
