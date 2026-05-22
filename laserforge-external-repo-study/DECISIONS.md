# DECISIONS

| ID | Date | Decision | Reason | Evidence | Status |
|---|---|---|---|---|---|
| DEC-001 | 2026-05-21 | Use `laserforge-external-repo-study/` as the dedicated study workspace. | Keeps cloned external repos, notes, artifacts, blockers, and fix candidates separate from production source and the older `audit/` workspace. | `laserforge_external_repo_study_FULL_MASTER_v1_3.md` requires a dedicated structure before cloning. | ACTIVE |
| DEC-002 | 2026-05-21 | Continue static study even when build toolchains are missing, but mark build/test claims as blocked or not run. | The executor requires honesty; missing Python/Java/Maven should not stop source inspection, but cannot be papered over. | `BLOCKERS.md` rows BLK-001 through BLK-003. | ACTIVE |

