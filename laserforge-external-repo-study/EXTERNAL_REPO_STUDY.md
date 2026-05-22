# EXTERNAL REPO STUDY

This file is the running index for the external repo study.

## Source Documents

- `../external-repo-study-and-audit.md`
- `C:/Users/Asus/Downloads/laserforge_external_repo_study_FULL_MASTER_v1_3.md`

## Repositories

Study order:

1. Rayforge
2. MeerK40t
3. LaserGRBL
4. LaserWeb4
5. VisiCut
6. LibLaserCut
7. K40 Whisperer
8. Universal G-Code Sender
9. bCNC
10. Candle
11. OpenBuilds CONTROL

## Evidence Rules

- `VERIFIED`: confirmed from official repo/docs or recorded local command artifact.
- `PARTIALLY VERIFIED`: source confirms part of the claim, but the full workflow was not locally or publicly validated.
- `UNVERIFIED`: plausible but not proven; must name what proof is missing.

## Current Status

Preflight setup started 2026-05-21. Rayforge, MeerK40t, LaserGRBL, LaserWeb4, VisiCut, LibLaserCut, K40 Whisperer, Universal G-Code Sender, bCNC, Candle, and OpenBuilds CONTROL have been cloned, pinned, statically inspected, cross-referenced, and registered in the findings/fix-plan candidate files.

Build/test execution status:

- Rayforge: NOT RUN - REASON RECORDED because Pixi/Python is not available locally.
- MeerK40t: NOT RUN - REASON RECORDED because Python/pip is not available locally.
- LaserGRBL: NOT RUN - REASON RECORDED because `msbuild`, `nuget`, `dotnet`, and `iscc` are not available locally.
- LaserWeb4: NOT RUN - REASON RECORDED because npm install/lifecycle scripts were intentionally not executed during this static study.
- VisiCut: NOT RUN - REASON RECORDED because Java/Maven are not available locally and dependency resolution was intentionally not started during this static study.
- LibLaserCut: NOT RUN - REASON RECORDED because Java/Maven are not available locally and dependency resolution was intentionally not started during this static study.
- K40 Whisperer: NOT RUN - REASON RECORDED because Python/pip/pytest/pyinstaller are not available locally and dependency resolution was intentionally not started during this static study.
- Universal G-Code Sender: NOT RUN - REASON RECORDED because Java/Maven are not available locally and Maven dependency resolution was intentionally not started during this static study.
- bCNC: NOT RUN - REASON RECORDED because Python resolves to the WindowsApps launcher, `pip`/`pytest`/`ruff` are not available locally, and dependency resolution was intentionally not started during this static study.
- Candle: NOT RUN - REASON RECORDED because CMake/Qt/vcpkg tooling was not available locally and dependency resolution was intentionally not started during this static study.
- OpenBuilds CONTROL: NOT RUN - REASON RECORDED because npm install/lifecycle scripts were intentionally not executed during this static study and `npm test` is a placeholder that exits successfully without real tests.

Next phase: run LaserForge sector audits one sector at a time using the external-repo lessons and the existing sector playbook. Do not start with a full-repo audit pass.
