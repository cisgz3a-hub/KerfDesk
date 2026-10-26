# Repairs and second audit of the latest 100 PR findings

The owner requested repairs for all seven findings in the [original audit](2026-10-23-last-100-pr-audit.md), a second audit and a pull request. This work starts from `cff4982191a3addf1b7cd29b667a5266a5cf215a`, including merged #1427. The original audit and [100-PR ledger](2026-10-23-last-100-pr-ledger.md) retain their earlier snapshot; their descriptions of open PRs are historical. [ADR-668](../decisions/ADR-668-last-100-pr-audit-repairs.md) records the repair decisions.

## Repair disposition

| Finding | Result and regression coverage |
| --- | --- |
| R100-01: Marlin stored macros | External Run and generic Marlin positioning-light mappings recognize M810–M819 as stored programs. Tests exercise the production normalizer, Run dialog and actual light actions, including command-number aliases and G53 parser routes. Ordinary accessory mappings and non-leading parameter text retain their documented behavior. |
| R100-02: stale camera nudge | Photo requests and saved results retain wizard, document, camera, device and calibration ownership. A departed context permanently retires the operation; Fix cannot apply its offset to a replacement document. The measured bed frame is retained. A late ring-burn preparation completion cannot overwrite a reopened wizard. |
| R100-03: camera refresh ordering | Manual, keyboard and after-job refresh share capture ownership. A newer request retires an older one even when the newer request fails. Live, hide, source and document changes retire pending publication. Picture and requested placement state publish together. |
| R100-04: quoted report secrets | Complete quoted JSON and key/value secrets are removed with escaped-quote and backslash handling. Raw removal-marker prefixes cannot preserve secret suffixes. The complete-key scanner avoids quadratic near-match retries. Raw report sections are redacted before assembly; incident cells are redacted before escaping. |
| R100-05: controller password aliases | Support reports use the shared bounded controller masker. FluidNC descriptive and ESP compatibility names work in dollar and bracket forms; numeric grblHAL aliases from #1427 remain covered. Console copies, report sections and backup-warning tests preserve their separate contracts. Restore exports remain intentional backups. |
| R100-06: old tile files | Reserved folders expose read-only immediate file-name enumeration. Saving reports same-job files left from changed bit counts or a smaller grid, while preserving their bytes. Case-insensitive replacement checks remain supported. An incomplete lookup retains known old/replaced names and adds a warning; it does not refuse saving. |
| R100-07: image-mode copy | PROJECT and website sources consistently describe twelve modes and include Blue Noise. Generated pages and existing website checks verify the copy; no algorithm changes were needed. |

## Independent second audit

The implementation owners cross-reviewed other lanes. Review found additional reachable cases within the seven findings, which were reproduced before repair:

- Marlin's fast G53 parser can skip adjacent text to the first space. Serial backslash handling and optional quoted-parameter unescaping can also expose a stored command. Probes through the production normalizer confirmed that these inputs reached the admission boundary. The guard considers the supported parser configurations without combining incompatible paths.
- Nudge's preceding burn-preparation completion could still overwrite another wizard after its await. Both successful and unsuccessful late completions now retain ownership.
- Raw password values beginning with a removal marker could leak a suffix. A long hyphenated near-key input also caused repeated scans. Both received focused regressions and repairs; report assembly no longer relies on trusting marker strings to survive a second raw-text redaction pass.
- A failed per-name existence lookup after successful folder enumeration discarded useful old-file evidence. Known names now survive alongside the incomplete-inspection warning.

These were repaired as part of their original finding families, rather than presented as unrelated new findings. The review also retained negative controls for ordinary commands, legitimate camera transitions, unrelated diagnostic fields and neighboring settings, and unrelated files in an export folder.

## Verification

Results are per cohort, not a sum of earlier and later runs:

| Check | Result |
| --- | --- |
| Marlin normalization, Run dialog and positioning-light actions | 269 tests across 8 files passed; the directly affected 94-test pair passed again after a lint-only helper extraction. Independent production-normalizer probe passed 15 positive/negative cases and a 10,000-prefix bounded-iteration case |
| Camera ownership and nudge | 56 distinct tests passed across the final seven-file cohort and the updated 16-test nudge cohort; earlier overlapping runs are not added |
| Reports, shared password masking, Console and backup warnings | 100 tests across 10 files passed |
| Tile export, folder history and production web adapter | 37 tests across 4 files passed |
| Website | 42 tests passed; all 17 pages generated locally and relevant copy inspected |
| Public pages, privacy and ADR checker regressions | 39 Node tests passed |
| Final-source typecheck | Passed with the repository's 6144 MiB compiler setting |
| Source lint | Passed: the first three repository partitions had no diagnostics, final edited files passed scoped checks, and the remaining source partition passed with local `build/**` artifacts excluded |
| Formatting and repository structure | Formatting passed; ADR numbering, physical file sizes, public-export ratchet, privacy/public-information and workflow pinning/secret-scope checks passed |
| Production web bundle | Passed, including service-worker generation; existing dependency annotation and chunk-size warnings remain |

Independent password probes additionally confirmed escaped-quote/backslash parity, marker tails, controller aliases with neighboring controls and preservation of an incident's subsequent `error:9`. The 120 KB failed-key input completed in about 6 ms in both implementation and independent runs. These measurements support the bounded-work regression; they are not a production performance guarantee.

The initial broad lint command also traversed ignored audit bundles and transformed test caches. It exited with diagnostics exclusively under local `build/` (9,974 generated diagnostic paths, none outside it). Those files were preserved. The final source partition was rerun excluding that evidence directory and passed; this does not modify or weaken the repository lint configuration.

The dependency licence scan could not finish locally: the existing pnpm store is missing the package-index entry for `@csstools/css-calc@2.1.4` (`ERR_PNPM_MISSING_PACKAGE_INDEX_FILE`). No dependency or lockfile changed. This is an uncompleted local gate, not a licence pass or an identified disallowed dependency; a fresh hosted install must run it.

Local logs and test reports are under `build/last100-seven-fixes-20261023/`; these ignored files are supporting evidence, not product source. The full repository unit suite was not run locally. Hosted checks must be assessed on the published PR head separately.

No hardware or live camera was exercised. Camera and dispatch tests use mocks around production stores, components and ownership logic. Firmware conclusions come from pinned upstream source and local parser probes, not a compiled controller trial. Generated website pages are a local preview. No package, deployed website, provider state or merge is qualified by these checks.
