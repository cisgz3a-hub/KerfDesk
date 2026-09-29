## ADR-551 - Network cameras start FFmpeg only by its full path from PATH (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried with an RTSP camera on Windows. | **Date:**
2026-09-29 | **Builds on:** ADR-116 and ADR-121 (the camera bridge and RTSP preview)

### Context

The desktop gap audit of 2026-09-29 (item 13) found that the camera bridge started FFmpeg by the
bare name `ffmpeg` (`electron/rtsp-camera-stream.ts`). On Windows a bare name is looked up in the
current folder before PATH, and KerfDesk's current folder can be wherever a project was
double-clicked, such as Downloads, so a planted `ffmpeg.exe` there would run with the customer's
rights. KerfDesk does not ship FFmpeg (the release checklist keeps it optional and assumes no
Homebrew path on macOS), and the messages when it is missing, or when Windows blocks a USB camera,
did not say what to do. The diagnostics line also still said "LaserForge Desktop".

### Decision

1. **Only absolute PATH folders.** The main process looks for `ffmpeg.exe` (Windows) or `ffmpeg`
   in each PATH folder that is absolute: a drive letter or network share on Windows, `/` elsewhere.
   Relative entries and the current folder are skipped. It keeps the first match's full path for
   the run and starts FFmpeg only by that path, for the preview, the single frame and the version
   check. Installing FFmpeg therefore needs a restart, as before.
2. **Missing FFmpeg says what to do:** "Network cameras need FFmpeg, which is not installed. Install
   FFmpeg, add its bin folder to PATH, then restart KerfDesk." The bridge refuses the preview
   without starting anything.
3. **A blocked USB camera points to Windows' own switch:** Settings, Privacy & security, Camera,
   let desktop apps use the camera.
4. The camera diagnostics say "update KerfDesk" instead of "update LaserForge Desktop".

### Consequences

- A file named `ffmpeg.exe` in the current folder or any relative PATH folder is never run.
- FFmpeg installed the usual way, with its bin folder on PATH, works as before. A copy known only
  to a shell's own PATH (for example Homebrew's on a Finder-launched Mac) is not found, as the
  release checklist already expects.
- Bundling FFmpeg stays out of scope.

### Tests

`electron/ffmpeg-path.test.ts` covers the PATH search, and `electron/rtsp-camera-stream.test.ts`
starting by full path and refusing without FFmpeg. The camera panel tests cover the new messages.
