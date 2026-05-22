# TASK COMPLETE LEDGER - LaserForge External Repo Study

## Metadata

- Started: 2026-05-21
- Agent: Codex
- LaserForge repo path: `C:/Users/Asus/LaserForge`
- External repo workspace: `C:/Users/Asus/LaserForge/laserforge-external-repo-study`
- Current phase: External comparator study complete; next phase is sector-by-sector LaserForge audit
- Last updated: 2026-05-21
- Final status: EXTERNAL COMPARATOR STUDY COMPLETE

---

## Non-Skipping Rule

No task may be marked complete unless:

1. The repo or file was actually inspected.
2. The command was actually run, or explicitly marked `NOT RUN`.
3. The evidence path, file reference, command output, or blocker is recorded.
4. The LaserForge cross-reference was attempted.
5. The finding was added to the correct output file.

---

## Overall Progress

| # | Repo | Clone | Build | Test | Static Audit | Safety Audit | LaserForge Cross-Reference | Repo Notes Written | Findings Registered | Fix Candidates Extracted | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Rayforge | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 2 | MeerK40t | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 3 | LaserGRBL | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 4 | LaserWeb4 | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 5 | VisiCut | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 6 | LibLaserCut | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 7 | K40 Whisperer | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 8 | Universal G-Code Sender | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 9 | bCNC | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 10 | Candle | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| 11 | OpenBuilds CONTROL | COMPLETE | NOT RUN - REASON RECORDED | NOT RUN - REASON RECORDED | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE | COMPLETE |

Allowed cell values:

- TODO
- IN PROGRESS
- COMPLETE
- NOT APPLICABLE
- NOT RUN - REASON RECORDED
- BLOCKED - SEE BLOCKERS.md
- FAILED - SEE BLOCKERS.md

---

## Per-Repo Completion Evidence

### 1. Rayforge

- Commit inspected: `3486764d188863c3e753f626e2661eebcc723572`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/rayforge`
- Build artifacts: `audit-artifacts/rayforge/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/rayforge/build-test-status.txt`; `audit-artifacts/rayforge/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/rayforge/file-list.txt`, `controller-surface.txt`, `origin-wcs-surface.txt`, `observability-surface.txt`
- Safety audit artifacts: `audit-artifacts/rayforge/laser-safety-surface.txt`, `repo-notes/01-rayforge.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/01-rayforge.md`

### 2. MeerK40t

- Commit inspected: `44043b8016197ba7ca84ee3f03608998313978e3`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/meerk40t`
- Build artifacts: `audit-artifacts/meerk40t/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/meerk40t/build-test-status.txt`; `audit-artifacts/meerk40t/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/meerk40t/file-list.txt`, `controller-surface.txt`, `raster-vector-surface.txt`, `origin-wcs-surface.txt`, `spooler-job-surface.txt`
- Safety audit artifacts: `audit-artifacts/meerk40t/laser-safety-surface.txt`, `repo-notes/02-meerk40t.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/02-meerk40t.md`

### 3. LaserGRBL

- Commit inspected: `1f9337b3af27133f8b1696e41cc110f2af74d04f`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/lasergrbl`
- Build artifacts: `audit-artifacts/lasergrbl/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/lasergrbl/build-test-status.txt`; `audit-artifacts/lasergrbl/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/lasergrbl/file-list.txt`, `controller-streaming-surface.txt`, `pipeline-preview-surface.txt`, `solution.txt`, `app-csproj.txt`
- Safety audit artifacts: `audit-artifacts/lasergrbl/laser-safety-surface.txt`, `repo-notes/03-lasergrbl.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/03-lasergrbl.md`

### 4. LaserWeb4

- Commit inspected: `9403a659a89d70dc0f18cff6194ce1820c9843c9`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/laserweb4`
- Build artifacts: `audit-artifacts/laserweb4/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/laserweb4/build-test-status.txt`; `audit-artifacts/laserweb4/test-release-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/laserweb4/file-list.txt`, `package-json.txt`, `cam-preview-surface.txt`, `performance-large-job-surface.txt`
- Safety audit artifacts: `audit-artifacts/laserweb4/controller-comm-surface.txt`, `repo-notes/04-laserweb4.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/04-laserweb4.md`

### 5. VisiCut

- Commit inspected: `511a28e82d6b28e95754cd0441e53f134c5930e3`
- Submodule inspected: `LibLaserCut` at `ebe72ea3af3b2ab52d797d8100c635f68722100e`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/visicut`
- Build artifacts: `audit-artifacts/visicut/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/visicut/build-test-status.txt`; `audit-artifacts/visicut/test-release-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/visicut/file-list.txt`, `pom.txt`, `pipeline-driver-surface.txt`, `test-release-surface.txt`
- Safety audit artifacts: `audit-artifacts/visicut/laser-safety-surface.txt`, `repo-notes/05-visicut.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/05-visicut.md`

### 6. LibLaserCut

- Commit inspected: `ebe72ea3af3b2ab52d797d8100c635f68722100e`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/liblasercut`
- Build artifacts: `audit-artifacts/liblasercut/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/liblasercut/build-test-status.txt`; `audit-artifacts/liblasercut/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/liblasercut/file-list.txt`, `pom.txt`, `driver-abstraction-surface.txt`, `bounds-origin-capability-surface.txt`
- Safety audit artifacts: `audit-artifacts/liblasercut/laser-safety-streaming-surface.txt`, `raster-surface.txt`, `repo-notes/06-liblasercut.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/06-liblasercut.md`

### 7. K40 Whisperer

- Commit inspected: `745c6ae2fa4b72fe53b966fb1a286ba472239485`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/k40-whisperer`
- Build artifacts: `audit-artifacts/k40-whisperer/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/k40-whisperer/build-test-status.txt`; `audit-artifacts/k40-whisperer/test-release-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/k40-whisperer/file-list.txt`, `README.md.txt`, `README_Linux.txt.txt`, `control-import-surface.txt`, `pipeline-surface.txt`
- Safety audit artifacts: `audit-artifacts/k40-whisperer/laser-safety-surface.txt`, `repo-notes/07-k40-whisperer.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/07-k40-whisperer.md`

### 8. Universal G-Code Sender

- Commit inspected: `a3e0356a136f7be70fc8221df83ace8a897d83a4`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/universal-g-code-sender`
- Build artifacts: `audit-artifacts/universal-g-code-sender/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/universal-g-code-sender/build-test-status.txt`; `audit-artifacts/universal-g-code-sender/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/universal-g-code-sender/file-list.txt`, `readme.txt`, `root-pom.txt`, `controller-streaming-surface.txt`, `state-origin-surface.txt`
- Safety audit artifacts: `audit-artifacts/universal-g-code-sender/laser-gcode-surface.txt`, `preview-parser-surface.txt`, `repo-notes/08-universal-g-code-sender.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/08-universal-g-code-sender.md`

### 9. bCNC

- Commit inspected: `8bcaac0f0f7b2200353d28e64b0e8e62eb6ad0ba`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/bcnc`
- Build artifacts: `audit-artifacts/bcnc/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/bcnc/build-test-status.txt`; `audit-artifacts/bcnc/test-surface.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/bcnc/file-list.txt`, `readme.txt`, `setup-py.txt`, `controller-streaming-surface.txt`, `origin-wcs-probe-surface.txt`, `cam-laser-surface.txt`
- Safety audit artifacts: `audit-artifacts/bcnc/controller-streaming-surface.txt`, `origin-wcs-probe-surface.txt`, `repo-notes/09-bcnc.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/09-bcnc.md`

### 10. Candle

- Commit inspected: `a4798f681c2ee5fc1ec5223c62649359ce5a3d47`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/candle`
- Build artifacts: `audit-artifacts/candle/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/candle/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Static audit artifacts: `audit-artifacts/candle/file-list.txt`, `readme.txt`, `cmakelists.txt`, `cmakepresets.txt`, `controller-streaming-surface.txt`, `preview-parser-surface.txt`
- Safety audit artifacts: `audit-artifacts/candle/laser-safety-surface.txt`, `origin-wcs-surface.txt`, `repo-notes/10-candle.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/10-candle.md`

### 11. OpenBuilds CONTROL

- Commit inspected: `1adcc121ba9e54713164363f25ea8eda1e122a41`
- Clone path: `C:/Users/Asus/LaserForge/laserforge-external-repo-study/cloned-repos/openbuilds-control`
- Build artifacts: `audit-artifacts/openbuilds-control/build-test-status.txt` (`NOT RUN - REASON RECORDED`)
- Test artifacts: `audit-artifacts/openbuilds-control/build-test-status.txt`; `audit-artifacts/openbuilds-control/test-release-surface.txt` (`NOT RUN - REASON RECORDED`; `npm test` is a placeholder)
- Static audit artifacts: `audit-artifacts/openbuilds-control/file-list.txt`, `package-json.txt`, `readme.txt`, `control-surface.txt`, `electron-security-surface.txt`, `test-release-surface.txt`
- Safety audit artifacts: `audit-artifacts/openbuilds-control/control-surface.txt`, `electron-security-surface.txt`, `repo-notes/11-openbuilds-control.md`
- LaserForge cross-reference section: `LASERFORGE_CROSS_REFERENCE.md`
- Repo notes file: `repo-notes/11-openbuilds-control.md`

---

## Final External Comparator Status

All planned comparator repositories have been cloned or captured, pinned, statically inspected, cross-referenced, and registered into the external findings/fix-plan candidate files.

This does not mean LaserForge has been audited against every lesson yet. The next phase must remain sector-by-sector:

1. Firmware/profile/GRBL settings
2. Scene/document/import/geometry
3. Raster/CAM planning
4. Vector/fill/path ordering
5. G-code emitter/modal semantics
6. Preview versus output consistency
7. Bounds/WCS/coordinates/Z-axis caveat
8. Streaming/serial/buffering/device send
9. Safety operations
10. Persistence/autosave/recovery/job logs
11. Electron/IPC/Falcon/security
12. Performance/large jobs
13. Release/signing/external beta/hardware evidence

Do not convert external lessons into LaserForge findings until the corresponding sector audit proves an exact file path, trigger path, failure mode, consequence, concrete fix, and required test.
