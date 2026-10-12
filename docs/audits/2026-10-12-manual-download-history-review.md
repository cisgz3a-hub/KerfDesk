# Manual Windows download history review

Reviewed on 12 October 2026 for the first catalogue migration introduced by PR #1159. This file records publication evidence for the operator-reviewed input in [manual-download-history.json](../releases/manual-download-history.json). It does not publish or change provider state.

## Authenticated baseline and archive

The current public manual release is **1.0.16**, source `eaae471da93cbdee761e9f4da06ac750667b3bbc`, published `2026-10-11T14:48:35.244Z`. The exact latest manifest SHA-256 is `ad66ffa4127286010a0cdc9029ae4c808d810636547d30d91b3460f9b88ae1fb`. The immutable 1.0.16 manifest matches latest byte for byte.

All 16 public immutable manifests in this review pass the repository's `verifyManualDownload` schema and pinned `stable-2026-09` Ed25519 verification. Each signed version matches its immutable URL. Each corresponding installer returns HTTP 200 with its exact signed byte count. Every published classification has a direct success receipt whose version and reported latest SHA-256 match the reviewed immutable manifest. Version order, ancestry, object existence and overall workflow conclusions were not used as promotion evidence.

The public `catalog.json` returns HTTP 404 with `Cache-Control: no-store` and `CF-Cache-Status: DYNAMIC`. The coordinated provider owner captured the authenticated Cloudflare dashboard's flat listing of `kerfdesk-downloads`, prefix `desktop/commercial-manual/releases/`, at `2026-10-12T13:57:41.677Z`. Its two pages contain 24 and 22 keys, respectively. The first page enables Next; the second disables Next. The combined listing contains 46 unique keys: 16 manifests, 17 installers and 13 notes sidecars.

The inventory exactly covers the 16 manifests in the migration JSON. Version 1.0.5 has an installer object but no immutable manifest; its public manifest also returns HTTP 404. It therefore has no migration entry. The partial upload is preserved, with no published or abandoned classification inferred for that version.

The complete inventory is retained as `D:/LaserForge/release-history-evidence-20261012/r2-listing.json`, SHA-256 `7577546eaaba2f799cbc5106d13cebe0df14ccdd15aa3adac327663c3acf4569`; `r2-last-page-dom.txt` retains the accompanying last-page browser evidence. This is an authenticated dashboard snapshot, not a signed API response. The publication code independently lists and validates the actual bucket again before writes, and refuses missing, additional or changed manifest evidence.

## Initial local publications

The first two versions predate the automatic workflow. Their original authorised local publisher logs are retained on the maintainer's D drive and contain these actual successful promotion receipts:

- `D:/LaserForge/pro-release-evidence-20260930/publication.log`: 260 bytes; file SHA-256 `bd6b507c37cc1a665a3716673c93c2bd486ba4fe34b66e8747ee321751508d4e`. Receipt: `Manual commercial release 1.0.0: published. Latest SHA-256: c18180317b4177deaa3530d782e74889e049438c086ca40ae6de8778f9770f3a. Unsigned installer; manual updates only.`
- `D:/LaserForge/pro-release-evidence-20260930/publication-1.0.1.log`: 340 bytes; file SHA-256 `53af8ad0391836cb1a56f0447bd2a5c75dab2a03bb4daa9ae3ad093a0843a5b5`. Receipt: `Manual commercial release 1.0.1: published. Latest SHA-256: 195c17f6ce75e29bf449beefab76c2b01ff4336392d631bdd8cee4971c561278. Unsigned installer; manual updates only.`

The same receipts also appear in the retained tool outputs of session `01a0f04c-4fca-7c21-b0c6-0b929b3f4184`, at `2026-09-30T08:20:52.209Z` and `2026-09-30T11:13:18.367Z`. The original logs and signed immutable manifests were re-read for this review.

## Hosted publication receipts

For each row below, the actual `publish` job log reports `Manual commercial release VERSION: published. Latest SHA-256: DIGEST.` The exact digest is recorded in the migration JSON and was compared with the signed immutable manifest bytes. The second 1.0.16 workflow, 38148414897, has no publication receipt and supplies no classification evidence.

| Version | Successful publication receipt |
| --- | --- |
| 1.0.2 | [36715829238, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36715829238/attempts/1) |
| 1.0.3 | [36759085173, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36759085173/attempts/1) |
| 1.0.4 | [36862750528, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36862750528/attempts/1) |
| 1.0.6 | [36893702385, attempt 2](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36893702385/attempts/2) |
| 1.0.7 | [36938681174, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36938681174/attempts/1) |
| 1.0.8 | [37032976208, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37032976208/attempts/1) |
| 1.0.9 | [37216671743, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37216671743/attempts/1) |
| 1.0.10 | [37320459300, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37320459300/attempts/1) |
| 1.0.11 | [37636998586, attempt 2](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37636998586/attempts/2) |
| 1.0.12 | [37810505264, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37810505264/attempts/1) |
| 1.0.13 | [37834306969, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37834306969/attempts/1) |
| 1.0.14 | [37888241075, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/37888241075/attempts/1) |
| 1.0.15 | [38067513945, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/38067513945/attempts/1) |
| 1.0.16 | [38148244827, attempt 1](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/38148244827/attempts/1) |

Raw public manifests, complete workflow metadata, hosted logs and extracted receipt audits are retained at `D:/LaserForge/release-history-evidence-20261012/`.

## Verification

At `2026-10-12T13:58:56.145Z`, a read-only reconciliation verified both page flags, exhausted pagination, all 46 unique keys and the exact combined listing. It re-read and authenticated every listed immutable manifest and current latest, then ran the repository's `reviewedManualHistory`, `prepareManualHistory` and `verifyManualCatalog` against these real inputs. The resulting catalogue contains all 16 reviewed published versions, with no provider writes. Latest still has the exact digest pinned in the migration JSON. The result is retained as `history-inventory-validation.json` in the evidence directory.

The existing catalogue, manual publisher and publisher CLI suites pass 24/24 cases with the frozen dependency lockfile. The first invocation, before installing dependencies in this new worktree, stopped because `js-yaml` was absent; it is not counted as a test pass. The migration JSON passes Prettier and the working diff passes `git diff --check`.

This review authenticates manifests and promotion receipts, and confirms public installer availability and signed sizes. It does not repeat full downloads or native installation of every historical installer; the release workflow separately verifies its actual upgrade baseline and candidate.
