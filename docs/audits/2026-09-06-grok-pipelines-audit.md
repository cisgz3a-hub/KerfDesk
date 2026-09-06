# Pipelines audit: independent adjudication and bounded repairs

Audited on 6 September 2026 against `c07cea275149832909d46f21c4dd7ec74d634f4a` in `C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906`. Grok supplied baseline `5918ef53fd91f6b33a4cd0766f2a3b7ba6991acc`. The workflow, script, package and builder paths relevant to these claims have no intervening baseline-to-main diff. IDs here are **pipelines-CI-01..12**, separate from the older CI IDs.

Two substantive defects reproduced: scanner failure could become a clean dependency report, and the stable SBOM omitted the real pnpm dependency entries. Two further changes improve report wording and retain known skipped/cancelled states. The other claims mostly describe deliberate, already documented limits. CI12's claimed conflict with non-reproducible rebuilds does not occur in the cited verification path.

This is source, isolated test, installed-dependency and read-only scanner evidence. The checks below did not execute a release, signing, installation, updater, provider or hardware lane. Live environment/secrets state was not inspected. Historical operational statements in WORKFLOW.md are dated and are not treated as current provider facts. Hosted PR checks are recorded on the pull request separately; local integration verification is recorded in the companion TIME5 report. Johann owns merging and release authorization.

| ID | Independent verdict | Assessed severity | Action |
|---|---|---|---|
| pipelines-CI-01 | Correct operational caveat; no demonstrated source defect | Informational; current activation unknown | Preserve stable-not-qualified boundary |
| pipelines-CI-02 | Partly right; intentional no-publish success and documented artifact omission | Low reporting limit | No workflow change |
| pipelines-CI-03 | Partly right; reports were per-workflow already, but state loss and scope wording were weak | Low–medium evidence quality | Preserve skipped/cancelled; clarify scope |
| pipelines-CI-04 | Partly right; real scanner-error defect, but advisory nonblocking policy is intentional | Medium | Validate evidence and exits; retain invalid report |
| pipelines-CI-05 | True artifact shape; intentional artifact-only dry run | Informational | No change |
| pipelines-CI-06 | True local build scope; no proof it enables trusted updates or certifies a release | Informational | No change |
| pipelines-CI-07 | Confirmed narrow evidence-label problem; Windows unpacked runtime scope is intentional | Low | Name exact runtime scope |
| pipelines-CI-08 | Intentional advisory triage policy, not an accidental omitted gate | Informational | No new gate |
| pipelines-CI-09 | True scheduling/deploy facts; intentional observability policy | Low operational risk; starvation unproven | No new deploy gate |
| pipelines-CI-10 | Confirmed; independent probe found a larger inventory omission than claimed | Medium | Traverse actual pnpm graph; extract declared license facts |
| pipelines-CI-11 | Intentional fail-fast chain; no false green shown | Informational | No change |
| pipelines-CI-12 | Unsupported as phrased; final verification uses published assets, not rebuilt bytes | No demonstrated defect | No change |

Line references below refer to the current worktree unless explicitly labelled **before**, which means the unmodified `c07cea275` source. The report includes the original code where a repair has replaced it.

**pipelines-CI-01 — Stable source does not prove stable activation.**

Grok is right that a finished YAML file cannot establish that signed stable distribution is live. [WORKFLOW.md:5658](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/WORKFLOW.md:5658) expressly dates its operational state to 25 July 2026, and step 4 at line 5679 remains future stable activation. It requires the protected environment, exact approved SHA and signing/R2 credentials. That historical text is insufficient to conclude the credentials are still absent today.

The implementation respects this boundary: [release-desktop-stable.yml:54](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-stable.yml:54) compares the tag source to `STABLE_APPROVED_RELEASE_SHA`; line 68 selects `environment: desktop-production`. It also checks annotated-tag identity/main ancestry before packaging and requires real signing credentials plus a valid Authenticode signature. Its introductory comments already separate future signed stable from unsigned Preview.

Verdict: an accurate qualification warning, not evidence that release code is wrong. Grok's High label is unsupported without an actual false release claim or bypass. Activating stable would be a separate operational task, not an audit fix.

**pipelines-CI-02 — Obsolete deployment candidates deliberately succeed without publishing.**

[resolve-web-deploy-identity.mjs:16](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/resolve-web-deploy-identity.mjs:16) returns `eligible: false` when an old successful CI result is no longer the main tip; the CLI records the result and exits normally. [deploy.yml:93](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/deploy.yml:93) writes an explicit “Production deployment skipped” summary with candidate SHA and reason. It says no candidate-tree build, report script or provider command ran. The first eligibility test uses a validated workflow-control copy of the resolver, not code taken from the stale candidate (`deploy.yml:77–90`).

The provider step is separately conditioned on the second freshness check (`deploy.yml:158`). Readiness generation/upload requires the first eligibility result (`deploy.yml:173,194`), so an early no-op indeed lacks that artifact. A later main-advanced skip also receives an explicit summary (`deploy.yml:140–154`).

Verdict: true artifact coverage limit, with a clear existing explanation. Job success here means the guarded workflow completed correctly, not that Cloudflare published. A generic green check alone should never be cited as deployment proof. I did not add a stale-candidate report execution or a new failure condition; the existing control-plane summary is sufficient for this bounded repair.

**pipelines-CI-03 — Known outcomes should not be collapsed into missing evidence.**

Before, `scripts/report-release-readiness.mjs:18–26` included:

```js
if (normalized === 'cancelled' || normalized === 'skipped') return 'not-run';
```

The report used the heading “Release readiness (informational)” while defaults and callers supplied `not-run` for unrelated lanes. For example, [ci.yml:63](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/ci.yml:63) reports CI's result and explicitly supplies `not-run` for browser, deployment, packaged runtime, perceptual and hardware lanes. [e2e.yml:62](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/e2e.yml:62) does the corresponding browser-only report. This was already informational with separate evidence lanes, not an implemented SHA aggregation service; Grok overstates a High-severity readiness failure.

The narrower repair at [report-release-readiness.mjs:18](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/report-release-readiness.mjs:18) preserves `skipped` and `cancelled`. Its policy now declares `scope: 'reported-lanes-only'` at line 41. The heading is “Workflow release evidence (informational)”; lines 63–64 explain that it is not an aggregate verdict and `not-run` means no observation supplied by this report. Tests distinguish known cancellation, known skip and an absent lane. No aggregation, browser deploy gate or hardware implication was added.

**pipelines-CI-04 — An actual scanner failure could masquerade as zero advisories.**

The broad assertion “nightly audit never fails” is false: dependency installation, malformed JSON, issue API failures and other workflow errors can fail it. Advisories themselves intentionally produce an issue instead of a red merge check. [ADR-254, DECISIONS.md:12361](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/DECISIONS.md:12361) explicitly removes audit from `release:check`, keeps a scheduled tracking issue, and assigns production reachability decisions to human triage. Lines 12382–12392 explicitly accept merges/deployments without automatic advisory failure. That policy is not a bug to reverse.

There was a separate correctness defect. Before, `scripts/report-dependency-audit.mjs:6–8` used `fullAudit.advisories ?? {}` and `runtimeAudit.advisories ?? {}`. `.github/workflows/audit.yml:64–68` captured scanner exits without feeding them into classification. Stable similarly discarded both audit exits with `|| true` before its runtime-count test.

Actual pnpm 11.3.0 failure reproduction:

```powershell
pnpm audit --json --registry=http://127.0.0.1:9 --fetch-retries=0 --fetch-timeout=1000
```

It exited 1 and returned `{"error":{"code":"pnpm","message":"fetch failed"}}`. The old classifier converted this into runtimeCount 0, both other counts 0 and an empty advisory array. Thus nightly could close the standing issue as clean; stable could pass its runtime-count check despite no scanner evidence. No security advisory needs to exist for this reporting failure to reproduce.

The repair validates the payload and supplied exits at [report-dependency-audit.mjs:54](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/report-dependency-audit.mjs:54). Normal advisory exit 1 remains valid when there are advisory records; error objects, malformed evidence, unsupported exits and contradictory clean/exit-1 results fail. The CLI still writes an explicit invalid evidence report with counts `null`, outputs `evidence_valid=false`, and exits unsuccessfully (`report-dependency-audit.mjs:143–175`). [audit.yml:76](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/audit.yml:76) passes both exits; lines 82 and 102 require valid evidence before updating or closing an issue. [release-desktop-stable.yml:112](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-stable.yml:112) now preserves both scanner exits and supplies them to the same reporter, keeping the existing stable runtime policy.

The classifier also takes the union of full and production snapshots, so a runtime advisory appearing between requests cannot disappear because only the earlier full snapshot was iterated. This has a focused regression.

Assessed Medium: concrete loss of release/advisory evidence, not proof a vulnerable build shipped. A normal read-only current scanner snapshot classified 0 runtime, 14 release-build-only and 5 build/test-only advisories. Those are point-in-time classifications, not a security certification.

**pipelines-CI-05 — Dry-run metadata has a production shape, but is not published.**

[release-desktop-dry-run.yml:39](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-dry-run.yml:39) gives the artifact a dispatch-specific version. Lines 53 and 60–64 run the release check, explicitly disable updater trust and signing, and use `--publish never`. Lines 78–85 upload an “unsigned dry-run artifact”, with a `kerfdesk-windows-dry-run-*` artifact name including local `latest.yml`.

[electron-builder.yml:46](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/electron-builder.yml:46) explains why the stable builder emits `latest.yml` and `.blockmap`; its generic provider URL is configured at line 52. The dry-run workflow has no R2/provider publication step. The feed file existing inside a labelled GitHub artifact does not establish that a stable feed was updated.

Verdict: factually correct shape, intentional and visibly contained packaging rehearsal. No demonstrated Medium-severity defect, and no change needed.

**pipelines-CI-06 — A local package command is not a release qualification command.**

[package.json:54](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/package.json:54) defines `build:desktop` as `pnpm build:electron-main && vite build && electron-builder --win --x64`. It does not run `release:check` or supply the CI stable metadata. That much is true. I have not executed this packaging command or inferred its publication behavior from electron-builder defaults.

Crucially, missing package metadata does not grant trusted updater access: [electron/update-channel-trust.ts:27](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/electron/update-channel-trust.ts:27) accepts only literal `kerfdeskUpdateChannelTrusted === true`; the reading helper falls back to false on missing/invalid metadata. Preview enablement separately requires literal channel `preview` at lines 45–50. The signed stable workflow carries independent tag, approved SHA, environment, release-check and signature requirements.

Verdict: a local development build is not qualified stable output. No evidence of an updater trust bypass or mistaken CI success. Making a separate explicitly labelled local package command could be an optional usability task, but is not necessary to fix the reproduced findings.

**pipelines-CI-07 — Native evidence should identify exactly what ran.**

[packaged-native-smoke.yml:38](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/packaged-native-smoke.yml:38) packages with `--win --x64 --dir --config electron-builder.preview.yml --publish never`; lines 47–49 launch `win-unpacked/KerfDesk.exe`. The workflow already explicitly disclaims installer/serial/hardware qualification in comments and names its job “Windows packaged launch/import/save”. The old generated evidence sentence, however, only said “1 isolated packaged launch/import/save scenario”, losing these limits when the artifact was read alone.

The report text at [packaged-native-smoke.yml:61](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/packaged-native-smoke.yml:61) now says Windows x64 unsigned Preview `--dir` launch/import/save only, with no installer, signing or update-channel qualification. This is a wording repair, not a new package-test gate.

The existing native harness is substantive: [verify-windows-packaged-native-smoke.mjs:15](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/verify-windows-packaged-native-smoke.mjs:15) requires a packaged app, isolated profile, visible window, successful import, nonempty saved project and the expected `app://app/index.html` renderer. It is legitimate unpacked Electron runtime evidence. It does not exercise NSIS installation, stable signing, updater delivery, macOS or hardware. No actual native launch was performed during this audit.

**pipelines-CI-08 — Preview's omitted stable hard gate is documented policy.**

[release-desktop-preview.yml:81](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-preview.yml:81), line 212 and line 284 run `release:check`; [package.json:45](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/package.json:45) has no audit step. Signed stable adds its own runtime-count check. Preview is explicitly a separate unsigned prerelease channel with no stable R2/update-metadata publication (`release-desktop-preview.yml:3–4`).

ADR-254 explicitly trades automatic advisory failures for scheduled tracking and human release triage, including the desktop release legs. This does not mean production advisories may be ignored; it means a new automatic Preview gate is a policy change, not a correction logically implied by the existing stable-specific rule. No untriaged production-reachable advisory or current release violation was demonstrated. No gate was added.

**pipelines-CI-09 — Browser cancellation and deployment independence are deliberate.**

[e2e.yml:15](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/e2e.yml:15) sets `cancel-in-progress: true`, including main. [deploy.yml:13](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/deploy.yml:13) listens to CI, not Browser smoke. Grok's factual observations are correct. But `e2e.yml:3–8` explicitly describes main browser runs as observability and explains why they do not gate deployment. The general CI workflow intentionally disables cancellation on main (`ci.yml:9–18`); this is not a hidden mismatch in what deploy waits for.

Rapid main changes could prevent a given browser run completing; that is a scheduling risk, not proof that current main lacks browser evidence or that deploy falsely reports browser completion. The report now retains observed cancellation under CI03. Neither the historical ADR-206 reference nor a report-only browser lane authorizes adding a deployment or Start gate. No scheduling change was needed to correct the proven defects; live main-run coverage would be a separate read-only operational check if requested.

**pipelines-CI-10 — The stable SBOM lost both inventory and available license facts.**

Before, `scripts/generate-release-evidence.mjs:25–33` wrote both license fields as `NOASSERTION`. More seriously, its `flattenDependencies` at lines 81–95 recorded a node only if `node.name && node.version`, then traversed `Object.values(node.dependencies)`. Real pnpm 11 full-depth dependency nodes have names in their keyed edges/`from` plus installed `path`; they generally have no `name` property. The existing test invented nested `name` properties and missed that production schema.

The actual command was `pnpm list --prod --json --depth Infinity`, matching the stable workflow input at [release-desktop-stable.yml:188](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-stable.yml:188). An independent count found 59 distinct name/version identities: the project plus 58 production dependency entries. Running the old stable generator on that exact JSON emitted **one package, laserforge**, with `licenseDeclared: NOASSERTION`.

The fix at [generate-release-evidence.mjs:89](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/generate-release-evidence.mjs:89) visits keyed dependency and optional-dependency edges, reads installed package manifests, deduplicates name/version entries and rejects conflicting declared license facts. It includes the packaged Electron host separately although Electron is declared as a development dependency; it does not mistake the host's download tooling for the installed binary. The root SBOM component now uses the actual release version. Available package license declarations populate `licenseDeclared`; absent declarations remain `NOASSERTION`, and `licenseConcluded` remains `NOASSERTION` because no legal conclusion is being invented.

That distinction follows SPDX's separate declared and concluded license fields: `NOASSERTION` is a legitimate unknown value, so merely seeing it is not itself a specification violation. The issue is missing known facts and, here, the omitted dependency graph. [SPDX 2.3 package information](https://spdx.github.io/spdx-spec/v2.3/package-information/)

The same real-input probe after repair emits **60 packages: root + 58 production identities + Electron**, with 60 declared license facts and all concluded fields still unknown. The new fixture also covers nested nodes, optional dependencies, aliased edges, legacy license objects, unknown licenses and exact root release version. Preview's existing [generate-release-integrity.mjs:225](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/scripts/generate-release-integrity.mjs:225) builds a richer CycloneDX inventory using the production closure and Electron, and includes font/artwork components. This fix does not claim the stable npm inventory is a file-level SBOM of every Chromium/native or asset component, nor that a signed installer was built.

**pipelines-CI-11 — Fail-fast means later checks are unrun, not falsely passed.**

[package.json:45](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/package.json:45) chains the release checks with `&&`. A failure prevents subsequent checks running and the command returns failure. This is a real diagnostic limitation when someone wants all independent failures in one run, but does not produce a green release check or erase the first failure. ADR-254 specifically removed nondeterministic audit failures from this chain; it did not require every remaining check to aggregate failure output.

Verdict: an intentional fail-fast gate, with no demonstrated correctness defect. A full independent-check aggregator would broaden this task and incur additional CI work. No change.

**pipelines-CI-12 — The final check verifies the published release, not a rebuild comparison.**

[release-desktop-preview.yml:451](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-preview.yml:451) detects an existing published prerelease and sets `already_published=true`. That skips draft asset upload and publication at lines 475 and 505. The unconditional final step at line 529 still validates the published release's exact source and immutable status.

The decisive code at [release-desktop-preview.yml:576](/C:/Users/Asus/.codex/worktrees/grok-ci-time5-20260906/.github/workflows/release-desktop-preview.yml:576) downloads into a separate `published-release-assets` directory. Line 582 checks the downloaded published checksum manifest against those downloaded published assets. Lines 583–587 check that published manifest's repository/SHA/ref/signer, and line 589 verifies each downloaded published asset. None of this compares the fresh `release-assets` binary bytes with the old immutable published binaries.

Therefore NSIS or signing nondeterminism in a rerun does not, by itself, create Grok's alleged contradiction. Builds before the existing-release check can be redundant, and identity/attestation/API failures should still fail verification. This was already the path at Grok's baseline; it is not a newly repaired defect. No published-release operation was run to test it.

**Reproduction and verification record**

Evidence directory: `C:/Users/Asus/.codex/audits/grok-ci-time5-20260906`.

- [pipeline-probes.mjs](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/pipeline-probes.mjs) independently counts the real pnpm graph, calls the actual stable generator, and passes the actual scanner error to the classifier. The installer input is explicitly a text fixture, not an executable. Command: `node C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/pipeline-probes.mjs`, run from the isolated source worktree.
- [runtime-dependencies-baseline.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/runtime-dependencies-baseline.json) is the actual full-depth production list. [pipeline-baseline-results.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/pipeline-baseline-results.json) retains the 59-input/1-output and false-clean reproduction. [pipeline-fixed-results.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/pipeline-fixed-results.json) retains the 60-output and rejected scanner error result.
- [audit-scanner-error-baseline.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/audit-scanner-error-baseline.json) is the actual pnpm loopback registry failure. [audit-full-current.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/audit-full-current.json) and [audit-runtime-current.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/audit-runtime-current.json) are normal read-only registry snapshots, exits 1 and 0 respectively. The fixed reporter produces [audit-valid-fixed/report.json](/C:/Users/Asus/.codex/audits/grok-ci-time5-20260906/audit-valid-fixed/report.json): 0 runtime, 14 release-build-only, 5 build/test-only.
- Before the source repairs, `node --test scripts/report-dependency-audit.test.mjs scripts/generate-release-evidence.test.mjs` ran eight tests: three prior tests passed and five added substantive regressions failed. After repair plus report-state tests, the three directly affected script suites passed 13/13.
- Final focused gate: `pnpm test:release-integrity` passed **49/49** tests. Its deliberately malformed ADR fixture prints expected rejection text; process result was exit 0. This includes the directly affected 13 tests; do not add them a second time.
- `pnpm exec vitest run src/platform/electron/release-desktop-workflow-gate.test.ts src/platform/electron/release-desktop-preview-workflow-gate.test.ts --maxWorkers=1` passed **29/29** across two files.
- `pnpm check:action-pins` passed for seven reviewed actions. Prettier check and `git diff --check` passed for all nine pipeline files. The companion TIME5 report records aggregate verification for the integrated patch.

**Changed scope and remaining action**

The nine pipeline files are `.github/workflows/audit.yml`, `.github/workflows/release-desktop-stable.yml`, `.github/workflows/packaged-native-smoke.yml`, and the three reporter/generator `.mjs` files with their three test files. They remained unchanged through integration verification. Timing changes and documentation are recorded in the companion report. Johann owns review and merging; no external release qualification follows from these local results.
