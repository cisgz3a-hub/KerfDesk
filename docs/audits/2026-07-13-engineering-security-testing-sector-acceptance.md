# KerfDesk Engineering, Security, and Testing Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.5/10**

**Candidate stack:** PR #58 through PR #95 + `codex/engineering-security-9-acceptance`

**Status:** Software candidate complete; full local release gate passed; signed tag execution pending

## Verdict

The stacked candidate earns **9.2/10** after passing the exact full release gate. It closes
the baseline's missing browser-E2E finding with 26 deterministic Chromium workflows and converts the
desktop updater from a permanently disabled/optionally signed path into a fail-closed signed release
chain. The repository also publishes a vulnerability-reporting policy appropriate for software that
controls hazardous machinery.

## Signed Update Boundary

Electron Builder documents that `forceCodeSigning` fails a build that would otherwise be unsigned,
that Windows update signature verification is enabled by default, and that the publisher identity is
used for verification:
[Windows configuration](https://www.electron.build/docs/win/). Its Windows signing guidance confirms
that supported code-signing certificates work with auto-update:
[Windows code signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).

KerfDesk makes those defaults explicit and adds a repository-specific trust chain:

1. Version-tag builds require certificate secrets and `forceCodeSigning=true`.
2. The final installer must report a valid Authenticode signature and publisher before upload.
3. Only that tag path embeds `kerfdeskUpdateChannelTrusted=true` in signed package metadata.
4. The packaged main process accepts only the exact boolean and otherwise fails closed.
5. Electron Builder's publisher-signature verification remains explicitly enabled.
6. Manual dispatch is unsigned, trust=false, and forbidden from publishing the live feed.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Browser E2E | 26 Chromium workflows cover files, serial, USB/RTSP camera, arrays, nesting, rotary, registration, materials, variables, tracing, recovery, motion, accessibility, and large projects | Accepted |
| Unit/property testing | Large Vitest suite includes controller simulators, safety invariants, parsers, geometry properties, perceptual trace metrics, and 1,114 box-generator assertions | Accepted |
| CI parity | Pull requests and `main` run the same `release:check` command used locally and by desktop releases | Accepted |
| Dependency governance | Frozen lockfile, allowlisted production licenses, generated notices, and low-severity vulnerability audit are blocking gates | Accepted |
| Electron isolation | Sandboxed renderer, context isolation, Node integration off, web security on, CSP parity tests, permission allowlists, and navigation/window guards | Accepted |
| Untrusted input | Project, SVG, CLB/LBRN, image, font, G-code, and machine-profile paths have resource, schema, or active-content controls with focused tests | Accepted |
| Desktop release signing | Tags require signing credentials, force signing, and validate Authenticode before upload or publication | Accepted by structure; signed tag run pending |
| Update client trust | Signed package metadata enables the client; absent, malformed, manual, or string metadata disables it | Accepted |
| Vulnerability reporting | Root security policy defines private reporting, safety-sensitive scope, disclosure, and hardware-test boundaries | Accepted |
| Architecture discipline | Boundary lint, hard/soft file-size gates, ADRs, workflow specification, and contribution rules are enforced or documented | Accepted |
| Stable performance gates | The 40-part outline-nesting benchmark uses the repository's local/CI wall-clock policy and retains a separate timeout ceiling | Accepted |

## Verification

- Focused update, release-workflow, CSP, permission, and navigation battery: **7 files, 31 tests passed**.
- Signed-package metadata rehearsal: embedded trust value verified as boolean `true` inside `app.asar`.
- Unsigned-package refusal rehearsal: `forceCodeSigning=true` refused the build with exit 1.
- Nesting performance budget: **8 tests passed** under local and CI budget modes.
- Chromium workflows: **26 passed**.
- Full repository release gate: **passed in 618 seconds**.

## Why 9.2

The baseline already rated KerfDesk's inspectable engineering evidence as the strongest in the
comparison. The candidate removes the concrete browser-automation gap and makes public desktop
updates cryptographically gated by a publisher identity instead of merely hash-checked from one
mutable origin. It also documents a private vulnerability path and preserves unusually broad safety,
security, property, perceptual, simulator, and browser coverage in one blocking release command.

The score remains below a perfect result because a real certificate-backed tag release has not yet
run, physical laser/CNC fault campaigns remain hardware-sector evidence, test coverage is risk-based
rather than a universal line-percentage target, and external penetration testing has not been
completed.

## Score Boundary

- **Shipped `main`: 8.5/10** until the stacked candidate merges and passes on the resulting `main`.
- **Stacked software candidate: 9.2/10** with focused and full local release gates passed.
- Successful signed-tag and packaged-update installation evidence is required before calling the
  release channel operational, even though unsigned publication is now structurally prohibited.
